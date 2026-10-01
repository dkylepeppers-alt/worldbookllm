import {
  bookSlugSchema,
  type AddEntityInput,
  type BookImportKind,
  type BookImportPreview,
  type BookImportResult,
  type BookCheckCommand,
  type BookCheckResult,
  type BookEntityKind,
  type BookFile,
  type BookFileDetail,
  type BookSearchResult,
  type BookSummary,
  type BookTree,
  type Checkpoint,
  type CheckpointDetail,
  type AddSeriesBookInput,
  type BookBuildFile,
  type BookBuildResult,
  type BookManuscript,
  type CreateBookBuildInput,
  type CreateBookInput,
  type CreateSeriesInput,
  type CreateBookImportInput,
  type ManuscriptImportResult,
  type MoveEntityInput,
  type RenameEntityInput,
  type StoryCommandOutcome,
  type StoryEnvelope,
  type StoryOptions,
  type WriteBookFileInput,
} from '@worldbookllm/shared';

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConflictError, InvalidImportError, NotFoundError, StoryCommandError } from '../errors.js';
import type { BookFileStore } from '../story/book-files.js';
import {
  IMPORT_KIND_DIRECTORIES,
  entityFileTitle,
  fillCreatedEntity,
  importedBody,
  kebabId,
  provenanceLines,
  renderEntityFile,
  renderResearchNote,
  suggestImportKind,
} from '../story/book-import.js';
import { sha256 } from '../story/book-files.js';
import {
  builtFileName,
  listBuildFiles,
  readBuildFile,
  removeBuildFile,
} from '../story/book-builds.js';
import { parseFrontmatter, type BookIndex } from '../story/book-index.js';
import { exportManuscript } from '../story/book-manuscript.js';
import { removeSeriesLinks, setFrontmatterField } from '../story/frontmatter-edit.js';
import type {
  CheckpointActor,
  CheckpointService,
  CheckpointSession,
} from '../story/checkpoints.js';
import { KeyedMutex } from '../story/keyed-mutex.js';
import {
  discardStagedProject,
  promoteStagedProject,
  stageProjectFiles,
  unpackProjectZip,
} from '../story/project-zip.js';
import { StagedBook, type StagedChange } from '../story/staging.js';
import { assertWritablePath, needsReindex } from '../story/write-rules.js';
import type { StoryCli, StoryRunResult } from '../story/story-cli.js';
import { STORY_COMMANDS, type StoryCommandName } from '../story/story-commands.js';
import { convertUpload } from './converters/index.js';

/** Lock key for book creation; the NUL byte keeps it apart from every book slug. */
const CREATE_LOCK = '\0create';

/** `story build` gets longer than other commands: an EPUB or DOCX of a long book takes a while. */
const BUILD_TIMEOUT_MS = 120_000;

/** Agent chats tied to a book. Attached after both services exist (they refer to each other). */
export interface BookChatLifecycle {
  /** Refuses while one of the book's chats has a turn running; `action` ends the message. */
  assertIdle(book: string, action?: string): void;
  removeForBook(book: string): void;
}

function stringField(frontmatter: Record<string, unknown> | null, key: string): string | null {
  const value = frontmatter?.[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function numberField(frontmatter: Record<string, unknown> | null, key: string): number | null {
  const value = frontmatter?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function linkField(frontmatter: Record<string, unknown> | null, key: string): string[] {
  const value = frontmatter?.[key];
  if (!Array.isArray(value)) return [];
  const slugs = value.flatMap((reference) => {
    if (typeof reference !== 'string') return [];
    const projectPath = reference
      .trim()
      .replace(/\/story\.md$/u, '')
      .replace(/\/+$/u, '');
    const slug = projectPath.split('/').at(-1);
    return slug !== undefined && bookSlugSchema.safeParse(slug).success ? [slug] : [];
  });
  return [...new Set(slugs)];
}

/**
 * Story-skills books (ADR 0014): creating and listing them, reading and
 * writing their files, entity operations through the story CLI, checks, and
 * checkpoint history. Every write runs under the book's lock and inside a
 * checkpoint, and the index is reconciled afterwards.
 */
export class BookService {
  private readonly locks = new KeyedMutex();
  private readonly checkCache = new Map<string, { revision: number; result: BookCheckResult }>();
  private chatLifecycle: BookChatLifecycle | null = null;

  constructor(
    private readonly files: BookFileStore,
    private readonly index: BookIndex,
    private readonly checkpoints: CheckpointService,
    private readonly cli: StoryCli,
  ) {}

  list(): BookSummary[] {
    return this.files.listBooks().map((slug) => this.summary(slug));
  }

  conflicts() {
    this.files.listLocations();
    return this.files.listDuplicates().map(({ slug, seriesId, kind }) => ({
      slug,
      seriesId,
      kind,
      path:
        seriesId === null
          ? `projects/${slug}`
          : `series/${seriesId}/${kind === 'series-bible' ? 'series-bible' : slug}`,
    }));
  }

  async removeFromSeries(slug: string, seriesId: string): Promise<BookSummary> {
    return this.locks.run(CREATE_LOCK, async () => {
      const members = this.list()
        .filter((book) => book.seriesId === seriesId)
        .map((book) => book.slug)
        .sort();
      if (!members.includes(slug) || this.files.locate(slug).kind !== 'book')
        throw new ConflictError('not_series_book', `${slug} is not a book in series ${seriesId}.`);
      const lock = (at: number): Promise<BookSummary> => {
        const member = members[at];
        return member === undefined ? remove() : this.locks.run(member, () => lock(at + 1));
      };
      const remove = async (): Promise<BookSummary> => {
        for (const member of members)
          this.chatLifecycle?.assertIdle(member, 'remove this series book');
        const before = new Map(members.map((member) => [member, this.files.snapshot(member)]));
        let moved = false;
        try {
          for (const member of members) {
            const story = this.files.readBytes(member, 'story.md')!.toString('utf8');
            const content = removeSeriesLinks(story, member === slug ? undefined : slug);
            // Do not reformat an unrelated sibling's frontmatter.
            if (
              member === slug ||
              linkField(parseFrontmatter(story).frontmatter, 'follows').includes(slug) ||
              linkField(parseFrontmatter(story).frontmatter, 'precedes').includes(slug)
            ) {
              this.files.write(member, 'story.md', content);
            }
          }
          this.files.moveOutOfSeries(slug, seriesId);
          moved = true;
          this.checkpoints.storeGroup(
            `Leave series ${seriesId}: ${slug}`,
            'user',
            members.map((book) => ({
              book,
              before: before.get(book)!,
              after: this.files.snapshot(book),
            })),
            { structural: true },
          );
        } catch (error) {
          if (moved) this.files.moveIntoSeries(slug, seriesId);
          for (const [member, snapshot] of before)
            for (const [path, bytes] of snapshot) this.files.write(member, path, bytes);
          throw error;
        } finally {
          for (const member of members) this.index.reconcile(member);
          this.checkCache.clear();
        }
        return this.summary(slug);
      };
      return lock(0);
    });
  }

  /** Series writes share normal book locks; all snapshots and history commit as one group. */
  async updateBooksAtomically(
    slugs: string[],
    label: string,
    build: () => Array<{ book: string; path: string; content: string }>,
    actor: CheckpointActor = 'user',
    activeBook?: string,
  ): Promise<Checkpoint[]> {
    const ordered = [...new Set(slugs)].sort();
    const lock = (at: number): Promise<Checkpoint[]> => {
      const slug = ordered[at];
      if (slug !== undefined) return this.locks.run(slug, () => lock(at + 1));
      return change();
    };
    const change = async (): Promise<Checkpoint[]> => {
      for (const slug of ordered) {
        this.files.root(slug);
        if (slug !== activeBook) this.chatLifecycle?.assertIdle(slug, 'sync this series');
        this.checkpoints.assertSessionCurrent(slug, null);
      }
      const changes = build();
      for (const change of changes) {
        if (!ordered.includes(change.book))
          throw new ConflictError('unlocked_book', 'Series write targets an unlocked book.');
        assertWritablePath(change.path);
      }
      const changed = [...new Set(changes.map((change) => change.book))];
      const before = new Map(changed.map((slug) => [slug, this.files.snapshot(slug)]));
      try {
        for (const change of changes) this.files.write(change.book, change.path, change.content);
        for (const slug of changed) {
          const root = this.files.root(slug);
          await this.cli.runOrThrow({ command: 'reindex', root });
          const validation = await this.cli.run({ command: 'validate', root, json: true });
          if (validation.exitCode !== 0 || validation.envelope?.ok !== true) {
            throw new StoryCommandError(
              validation.exitCode || 1,
              `Series sync failed validation in ${slug}: ${validation.envelope?.diagnostics.map((item) => item.message).join('; ') ?? validation.stderr}`,
            );
          }
        }
        return this.checkpoints.storeGroup(
          label,
          actor,
          changed.map((book) => ({
            book,
            before: before.get(book)!,
            after: this.files.snapshot(book),
          })),
        );
      } catch (error) {
        for (const [slug, snapshot] of before) {
          for (const path of this.files.snapshot(slug).keys()) {
            if (!snapshot.has(path)) this.files.remove(slug, path);
          }
          for (const [path, bytes] of snapshot) this.files.write(slug, path, bytes);
        }
        throw error;
      } finally {
        for (const slug of changed) this.index.reconcile(slug);
        this.checkCache.clear();
      }
    };
    return lock(0);
  }

  async create(input: CreateBookInput): Promise<BookSummary> {
    const options: StoryOptions = {};
    if (input.genre) options.genre = input.genre;
    if (input.subGenre) options['sub-genre'] = input.subGenre;
    if (input.pov) options.pov = input.pov;
    if (input.tense) options.tense = input.tense;
    if (input.form) options.form = input.form;
    if (input.synopsis) options.synopsis = input.synopsis;
    // One lock for every create, so two books with the same title cannot pick the same folder.
    const slug = await this.locks.run(CREATE_LOCK, async () => {
      const free = this.freeSlug(input.title);
      await this.cli.runOrThrow({
        command: 'init',
        cwd: this.files.projectsDir,
        dir: free,
        args: [input.title],
        options,
      });
      return free;
    });
    return this.summary(slug);
  }

  get(slug: string): BookSummary {
    return this.summary(slug);
  }

  /** Wires agent-chat cleanup so trashing a book retires its chats. */
  attachChatLifecycle(lifecycle: BookChatLifecycle): void {
    this.chatLifecycle = lifecycle;
  }

  async trash(slug: string): Promise<void> {
    await this.locks.run(slug, () => {
      // Trashing one folder of a series would strand its siblings or leave
      // their links pointing at nothing (ADR 0018); that needs a series-aware remove.
      if (this.files.locate(slug).seriesId !== null) {
        throw new ConflictError(
          'in_series',
          'Books in a series and series bibles cannot be moved to trash yet.',
        );
      }
      this.chatLifecycle?.assertIdle(slug);
      this.files.trash(slug);
      this.index.removeBook(slug);
      this.checkpoints.removeBook(slug);
      this.checkCache.delete(slug);
      this.chatLifecycle?.removeForBook(slug);
    });
  }

  /** Creates a series (ADR 0018): its folder and its bible, addressed by the series id. */
  async createSeries(input: CreateSeriesInput): Promise<BookSummary> {
    const id = await this.locks.run(CREATE_LOCK, () => this.initSeries(input.title));
    return this.summary(id);
  }

  /**
   * Starts a new book inside a series. Linking it after or before a sibling
   * also rewrites that sibling's story.md, so the link is a checkpoint there,
   * and it waits for, and refuses during, an agent turn in that sibling.
   */
  async addToSeries(seriesId: string, input: AddSeriesBookInput): Promise<BookSummary> {
    const folder = this.files.seriesFolder(seriesId);
    const anchor = input.follows ?? input.precedes;
    if (anchor !== undefined) {
      const location = this.files.locate(anchor);
      if (location.kind !== 'book' || location.seriesId !== seriesId) {
        throw new ConflictError('not_in_series', `${anchor} is not a book in ${seriesId}.`);
      }
    }
    const slug = await this.locks.run(CREATE_LOCK, async () => {
      const free = this.freeSlug(input.title);
      const options: StoryOptions = { series: seriesId };
      if (input.follows !== undefined) options.follows = [input.follows];
      if (input.precedes !== undefined) options.precedes = [input.precedes];
      if (input.bookNumber !== undefined) options['book-number'] = String(input.bookNumber);
      const init = () =>
        this.cli.runOrThrow({
          command: 'init',
          cwd: folder,
          dir: free,
          args: [input.title],
          options,
        });
      if (anchor === undefined) {
        await init();
      } else {
        await this.locks.run(anchor, async () => {
          this.chatLifecycle?.assertIdle(anchor, 'adding a book linked to it');
          await this.checkpoints.record(anchor, `Link ${input.title}`, 'user', 'book', init);
          this.index.reconcile(anchor);
        });
      }
      return free;
    });
    this.files.rescan();
    // The style sheet is series-wide, so a new book starts from the bible's.
    this.copyStyleSheet(seriesId, slug);
    return this.summary(slug);
  }

  /** Moves a standalone book into an existing series and names the series in its story.md. */
  async moveIntoSeries(slug: string, seriesId: string): Promise<BookSummary> {
    this.files.seriesFolder(seriesId);
    await this.locks.run(slug, () => this.joinSeries(slug, seriesId));
    return this.summary(slug);
  }

  /**
   * Makes a standalone book the first book of a new series. The book is
   * checked before the series is created, and the series is removed again if
   * the move fails, so a refused move leaves nothing behind.
   */
  async moveIntoNewSeries(slug: string, title: string): Promise<BookSummary> {
    await this.locks.run(CREATE_LOCK, () =>
      this.locks.run(slug, async () => {
        this.assertCanJoinSeries(slug);
        const seriesId = await this.initSeries(title);
        try {
          await this.joinSeries(slug, seriesId);
        } catch (error) {
          this.files.removeSeriesFolder(seriesId);
          throw error;
        }
        // The new bible adopts the book's style sheet as the series'.
        this.copyStyleSheet(slug, seriesId);
      }),
    );
    return this.summary(slug);
  }

  /** Copies one project's style sheet over another's, for a project the caller just created. */
  private copyStyleSheet(from: string, to: string): void {
    const sheet = this.files.readBytes(from, 'style-sheet.md');
    if (sheet === null) return;
    this.files.write(to, 'style-sheet.md', sheet);
    this.index.reconcile(to);
  }

  /** Runs `story init` for a new series' bible. Caller holds the create lock. */
  private async initSeries(title: string): Promise<string> {
    const id = this.freeSlug(title);
    const folder = this.files.createSeriesFolder(id);
    try {
      await this.cli.runOrThrow({
        command: 'init',
        cwd: folder,
        dir: 'series-bible',
        args: [title],
        options: { series: id },
      });
    } catch (error) {
      this.files.removeSeriesFolder(id);
      throw error;
    }
    this.files.rescan();
    return id;
  }

  private assertCanJoinSeries(slug: string): void {
    this.chatLifecycle?.assertIdle(slug, 'moving it into a series');
    const location = this.files.locate(slug);
    if (location.kind !== 'book' || location.seriesId !== null) {
      throw new ConflictError('already_in_series', `${slug} is already part of a series.`);
    }
  }

  /** Moves the book and records `series:` in story.md as a checkpoint. Caller holds the book lock. */
  private async joinSeries(slug: string, seriesId: string): Promise<void> {
    this.assertCanJoinSeries(slug);
    this.files.moveIntoSeries(slug, seriesId);
    this.checkCache.delete(slug);
    const story = this.files.readBytes(slug, 'story.md')?.toString('utf8') ?? '';
    await this.checkpoints.record(
      slug,
      `Join series ${seriesId}`,
      'user',
      'book',
      () => this.files.write(slug, 'story.md', setFrontmatterField(story, 'series', seriesId)),
      { structural: true },
    );
    this.index.reconcile(slug);
  }

  tree(slug: string): BookTree {
    const book = this.summary(slug);
    return { book, files: this.index.list(slug) };
  }

  readFile(slug: string, path: string): BookFileDetail {
    this.index.reconcile(slug);
    const file = this.index.get(slug, path);
    const bytes = file ? this.files.readBytes(slug, path) : null;
    if (!file || bytes === null) throw new NotFoundError(`${path} was not found in ${slug}`);
    const content = bytes.toString('utf8');
    return { ...file, content, frontmatter: parseFrontmatter(content).frontmatter };
  }

  async writeFile(
    slug: string,
    path: string,
    input: WriteBookFileInput,
    actor: CheckpointActor = 'user',
  ): Promise<{ file: BookFile; checkpoint: Checkpoint | null }> {
    assertWritablePath(path);
    return this.locks.run(slug, async () => {
      const current = this.files.readBytes(slug, path);
      const currentHash = current === null ? null : sha256(current);
      if (currentHash !== input.expectedHash) {
        throw new ConflictError(
          'file_changed',
          current === null
            ? `${path} does not exist anymore.`
            : input.expectedHash === null
              ? `${path} already exists.`
              : `${path} changed since it was loaded.`,
        );
      }
      const label = `${current === null ? 'Create' : 'Edit'} ${path}`;
      const { checkpoint } = await this.checkpoints.record(
        slug,
        label,
        actor,
        needsReindex(path) ? 'book' : { paths: [path] },
        () => this.writeAndReindex(slug, path, input.content),
      );
      this.index.reconcile(slug);
      const file = this.index.get(slug, path);
      if (!file) throw new NotFoundError(`${path} was not found in ${slug}`);
      return { file, checkpoint };
    });
  }

  search(slug: string, query: string): BookSearchResult[] {
    this.files.root(slug);
    this.index.reconcile(slug);
    return this.index.search(slug, query);
  }

  addEntity(slug: string, input: AddEntityInput): Promise<StoryCommandOutcome> {
    return this.runEntityCommand(slug, `Add ${input.kind} ${input.name}`, {
      command: 'add',
      args: [input.kind, input.name],
      options: input.options,
    });
  }

  renameEntity(
    slug: string,
    kind: BookEntityKind,
    id: string,
    input: RenameEntityInput,
  ): Promise<StoryCommandOutcome> {
    return this.runEntityCommand(slug, `Rename ${kind} ${id} to ${input.name}`, {
      command: 'rename',
      args: [kind, id, input.name],
      options: input.id ? { id: input.id } : {},
    });
  }

  moveEntity(
    slug: string,
    kind: BookEntityKind,
    id: string,
    input: MoveEntityInput,
  ): Promise<StoryCommandOutcome> {
    const options: StoryOptions = {};
    if (input.number !== undefined) options.number = String(input.number);
    if (input.chapter !== undefined) options.chapter = input.chapter;
    if (input.scene !== undefined) options.scene = String(input.scene);
    return this.runEntityCommand(slug, `Move ${kind} ${id}`, {
      command: 'move',
      args: [kind, id],
      options,
    });
  }

  removeEntity(slug: string, kind: BookEntityKind, id: string): Promise<StoryCommandOutcome> {
    return this.runEntityCommand(slug, `Remove ${kind} ${id}`, {
      command: 'remove',
      args: [kind, id],
    });
  }

  async check(slug: string, command: BookCheckCommand, fresh = false): Promise<BookCheckResult> {
    const root = this.files.root(slug);
    this.index.reconcile(slug);
    const revision = this.index.revision(slug);
    const cached = this.checkCache.get(`${slug}:${command}`);
    if (!fresh && cached && cached.revision === revision) return cached.result;
    const result = await this.cli.run({ command, root, json: true });
    if (!result.envelope) {
      throw new StoryCommandError(
        result.exitCode,
        result.stderr.trim() || `story ${command} printed no result`,
      );
    }
    const checked: BookCheckResult = {
      command,
      exitCode: result.exitCode,
      envelope: result.envelope,
    };
    this.checkCache.set(`${slug}:${command}`, { revision, result: checked });
    return checked;
  }

  listCheckpoints(slug: string): Checkpoint[] {
    this.files.root(slug);
    return this.checkpoints.list(slug);
  }

  checkpointDetail(slug: string, id: string): CheckpointDetail {
    this.files.root(slug);
    return this.checkpoints.detail(slug, id);
  }

  async undo(slug: string, id: string): Promise<Checkpoint> {
    this.files.root(slug);
    return this.locks.run(slug, () => {
      const checkpoint = this.checkpoints.undo(slug, id);
      this.index.reconcile(slug);
      return checkpoint;
    });
  }

  /** Converts an upload for review, suggesting the entity kind each entry should become. */
  async previewImport(slug: string, bytes: Buffer, fileName: string): Promise<BookImportPreview> {
    this.files.root(slug);
    const preview = await convertUpload(bytes, fileName);
    return {
      format: preview.format,
      origin: preview.origin,
      conversionNotes: preview.conversionNotes,
      entries: preview.entries.map((entry) => ({
        ...entry,
        ...suggestImportKind(entry.markdown, preview.format),
      })),
    };
  }

  /**
   * Saves reviewed entries into a book as one checkpoint (ADR 0014 decision
   * 5): research notes are written from the `story add research` template,
   * entity files keep their own frontmatter, and other kinds are created with
   * `story add` and given the imported text. Every file carries flat
   * provenance keys. If validation then reports an error in any imported
   * file, the whole import is undone and the diagnostics are returned as the
   * error.
   */
  async importEntries(slug: string, input: CreateBookImportInput): Promise<BookImportResult> {
    const provenance = provenanceLines(
      input.origin,
      input.conversionNotes,
      new Date().toISOString(),
    );
    const label =
      input.entries.length === 1
        ? `Import ${input.entries[0]?.title ?? ''}`
        : `Import ${input.entries.length} entries`;
    return this.writeImports(
      slug,
      label,
      input.entries.map((entry) => ({ ...entry, provenance })),
    );
  }

  /**
   * Writes prepared import entries as one checkpoint, then reindexes and
   * validates, undoing everything when validation rejects an imported file.
   * Each entry brings its own provenance lines, so callers with mixed origins
   * (the notebook migration) share this path.
   */
  async writeImports(
    slug: string,
    label: string,
    entries: readonly ImportEntry[],
  ): Promise<BookImportResult> {
    const root = this.files.root(slug);
    return this.locks.run(slug, async () => {
      this.index.reconcile(slug);
      const taken = new Set(this.index.list(slug).map((file) => file.path));
      const written: string[] = [];

      const { checkpoint } = await this.checkpoints.record(
        slug,
        label,
        'user',
        'book',
        async () => {
          for (const entry of entries) {
            const { suggestedKind, entityFile } = suggestImportKind(entry.markdown, 'markdown');
            const keepAsEntity = entityFile && suggestedKind === entry.kind;
            const title = (keepAsEntity ? entityFileTitle(entry.markdown) : null) ?? entry.title;
            const directory = IMPORT_KIND_DIRECTORIES[entry.kind];
            const id = uniqueId(kebabId(title) || entry.kind, directory, taken);
            const path = `${directory}/${id}.md`;
            taken.add(path);

            if (keepAsEntity) {
              this.files.write(slug, path, renderEntityFile(entry.markdown, entry.provenance));
            } else if (entry.kind === 'research') {
              const body = importedBody(entry.markdown, entry.title, false);
              this.files.write(slug, path, renderResearchNote(entry.title, body, entry.provenance));
            } else {
              await this.cli.runOrThrow({
                command: 'add',
                root,
                args: [entry.kind, entry.title],
                options: { id },
              });
              const created = this.files.readBytes(slug, path)?.toString('utf8');
              if (created === undefined) {
                throw new StoryCommandError(1, `story add did not create ${path}`);
              }
              const body = importedBody(entry.markdown, entry.title, false);
              this.files.write(slug, path, fillCreatedEntity(created, body, entry.provenance));
            }
            written.push(path);
          }
          await this.cli.runOrThrow({ command: 'reindex', root });
        },
      );

      const validation = await this.cli.run({ command: 'validate', root, json: true });
      const imported = new Set(written);
      const errors = (validation.envelope?.diagnostics ?? []).filter(
        (diagnostic) =>
          diagnostic.severity === 'error' &&
          typeof diagnostic.file === 'string' &&
          imported.has(diagnostic.file),
      );
      if (errors.length > 0 && checkpoint) {
        this.checkpoints.undo(slug, checkpoint.id);
        this.index.reconcile(slug);
        throw new InvalidImportError(
          `The import was undone because story validate rejected it: ${errors
            .map((error) => error.message)
            .join('; ')}`,
        );
      }
      this.index.reconcile(slug);
      return {
        files: written,
        checkpointId: checkpoint?.id ?? null,
        validation: validation.envelope,
      };
    });
  }

  /**
   * Creates a new book from a manuscript with `story import`, which splits it
   * into chapters. The upload is written to an operation-specific temporary
   * directory that is removed afterwards, whatever happens.
   */
  async importManuscript(bytes: Buffer, fileName: string): Promise<ManuscriptImportResult> {
    const extension = /\.(md|markdown|txt)$/iu.exec(fileName)?.[1]?.toLowerCase();
    if (!extension) throw new InvalidImportError('Upload the manuscript as a .md or .txt file.');
    if (bytes.byteLength === 0) throw new InvalidImportError('The uploaded file is empty.');
    const title = fileName.replace(/\.[^.]+$/u, '').trim() || 'Imported manuscript';
    const workDir = mkdtempSync(join(tmpdir(), 'worldbookllm-import-'));
    try {
      const source = join(workDir, `manuscript.${extension === 'txt' ? 'txt' : 'md'}`);
      writeFileSync(source, bytes, { mode: 0o600 });
      const { slug, output } = await this.locks.run(CREATE_LOCK, async () => {
        const free = this.freeSlug(title);
        const result = await this.cli.runOrThrow({
          command: 'import',
          cwd: this.files.projectsDir,
          dir: free,
          args: [source],
          options: { title },
        });
        return { slug: free, output: result.stdout.replaceAll(source, fileName).trim() };
      });
      return { book: this.summary(slug), output };
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }

  /**
   * Creates a new book from a zipped story-skills project (ADR 0020). The
   * project is unpacked into a hidden folder beside the books, its series
   * links are dropped (it arrives as a standalone book), its registries are
   * regenerated, and it is validated; only then is the folder renamed into
   * place. An archive the CLI cannot use as a project is rejected whole.
   */
  async importProject(bytes: Buffer, fileName: string): Promise<ManuscriptImportResult> {
    const archive = await unpackProjectZip(bytes);
    const story = archive.files.find((file) => file.path === 'story.md');
    const notes: string[] = [];
    let storyText = story?.data.toString('utf8') ?? '';
    const storyFields = parseFrontmatter(storyText).frontmatter;
    if (
      story !== undefined &&
      ['series', 'series-title', 'book-number', 'follows', 'precedes'].some(
        (key) => storyFields?.[key] !== undefined,
      )
    ) {
      storyText = removeSeriesLinks(storyText);
      story.data = Buffer.from(storyText, 'utf8');
      notes.push('Removed its series links: it was imported as a standalone book.');
    }
    const title =
      stringField(storyFields, 'title') ??
      (fileName.replace(/\.zip$/iu, '').trim() || 'Imported project');

    const { slug, validation } = await this.locks.run(CREATE_LOCK, async () => {
      const staging = stageProjectFiles(this.files.projectsDir, archive.files);
      try {
        // Missing or stale registries are regenerated. A project whose files do
        // not parse cannot be reindexed; it is still imported, and validation
        // below names the files to fix.
        const reindex = await this.cli.run({ command: 'reindex', root: staging });
        if (reindex.exitCode !== 0) {
          const reason = (reindex.stderr.trim() || reindex.stdout.trim()).split('\n')[0];
          notes.push(`story reindex could not regenerate the registries: ${reason}`);
        }
        const result = await this.cli.run({ command: 'validate', root: staging, json: true });
        if (result.exitCode !== 0 && result.exitCode !== 1) {
          const message =
            result.envelope?.diagnostics.find((entry) => entry.severity === 'error')?.message ??
            (result.stderr.trim() || result.stdout.trim() || 'story validate failed');
          throw new InvalidImportError(`The archive is not a usable story project: ${message}`);
        }
        const free = this.freeSlug(title);
        promoteStagedProject(staging, this.files.projectsDir, free);
        return { slug: free, validation: result.envelope };
      } catch (error) {
        discardStagedProject(staging);
        throw error;
      }
    });

    const errors = validation?.diagnostics.filter((entry) => entry.severity === 'error') ?? [];
    const warnings = validation?.diagnostics.filter((entry) => entry.severity === 'warning') ?? [];
    const lines = [
      `Imported ${archive.files.length} ${archive.files.length === 1 ? 'file' : 'files'} from ${fileName}.`,
      ...notes,
      errors.length === 0 && warnings.length === 0
        ? 'story validate found no problems.'
        : `story validate found ${errors.length} ${errors.length === 1 ? 'error' : 'errors'} and ${warnings.length} ${warnings.length === 1 ? 'warning' : 'warnings'}; see the Health tab.`,
    ];
    if (archive.skipped.length > 0) {
      lines.push(
        `Skipped ${archive.skipped.length}:`,
        ...archive.skipped.map((entry) => `- ${entry}`),
      );
    }
    return { book: this.summary(slug), output: lines.join('\n') };
  }

  /** The manuscript for reading, under the book lock so it never catches a write halfway. */
  manuscript(slug: string): Promise<BookManuscript> {
    return this.locks.run(slug, () => exportManuscript(this.cli, this.files.root(slug)));
  }

  /** Builds a disposable manuscript file into the book's `dist/` with `story build`. */
  async build(slug: string, input: CreateBookBuildInput): Promise<BookBuildResult> {
    const options: StoryOptions = { format: input.format };
    if (input.shunn) options.shunn = true;
    if (input.trim !== undefined) options.trim = input.trim;
    if (input.stamp !== undefined) options.stamp = input.stamp;
    return this.locks.run(slug, async () => {
      const root = this.files.root(slug);
      const result = await this.cli.run({
        command: 'build',
        root,
        options,
        timeoutMs: BUILD_TIMEOUT_MS,
      });
      const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n');
      // Exit 1 after a build means its warnings include ones story.md promotes
      // to errors; the file is written all the same, so it is returned with them.
      const name = builtFileName(result.stdout);
      const file =
        result.exitCode === 0 || result.exitCode === 1
          ? listBuildFiles(root).find((entry) => entry.name === name)
          : undefined;
      if (file === undefined) {
        throw new StoryCommandError(
          result.exitCode === 0 ? 1 : result.exitCode,
          output || 'story build finished but wrote no file to dist/',
        );
      }
      return { file, output };
    });
  }

  /** Under the book lock, so a listing never sees a build half-written or a file mid-delete. */
  listBuilds(slug: string): Promise<BookBuildFile[]> {
    return this.locks.run(slug, () => listBuildFiles(this.files.root(slug)));
  }

  /** A build file's bytes, for download. */
  readBuild(slug: string, name: string): Promise<Buffer> {
    return this.locks.run(slug, () => readBuildFile(this.files.root(slug), name));
  }

  async removeBuild(slug: string, name: string): Promise<void> {
    await this.locks.run(slug, () => removeBuildFile(this.files.root(slug), name));
  }

  /** The book's root folder, for callers that confine paths themselves. */
  root(slug: string): string {
    return this.files.root(slug);
  }

  /** Lists the book's indexed files after reconciling with the disk. */
  listFiles(slug: string): BookFile[] {
    this.files.root(slug);
    this.index.reconcile(slug);
    return this.index.list(slug);
  }

  /**
   * Writes a file as part of a checkpoint session (an agent turn): under the
   * book lock, with the same path rules as user writes, reindexing after
   * entity edits.
   */
  async writeInSession(
    session: CheckpointSession,
    path: string,
    content: string,
    expectedHash: string | null,
  ): Promise<void> {
    assertWritablePath(path);
    const slug = session.book;
    await this.locks.run(slug, () => {
      const current = this.files.readBytes(slug, path);
      const currentHash = current === null ? null : sha256(current);
      if (currentHash !== expectedHash) {
        throw new ConflictError(
          'file_changed',
          current === null
            ? `${path} does not exist anymore.`
            : expectedHash === null
              ? `${path} already exists.`
              : `${path} changed since it was read.`,
        );
      }
      return this.writeCaptured(session, path, content);
    });
  }

  /**
   * Replaces one exact passage. The read, the uniqueness check, and the write
   * share the book lock so a user edit cannot land between them.
   */
  async editInSession(
    session: CheckpointSession,
    path: string,
    find: string,
    replace: string,
  ): Promise<void> {
    assertWritablePath(path);
    const slug = session.book;
    await this.locks.run(slug, () => {
      const bytes = this.files.readBytes(slug, path);
      if (bytes === null) throw new NotFoundError(`${path} was not found in ${slug}`);
      const current = bytes.toString('utf8');
      let occurrences = 0;
      let offset = 0;
      while ((offset = current.indexOf(find, offset)) !== -1) {
        occurrences += 1;
        offset += 1;
      }
      if (occurrences !== 1) {
        throw new Error(
          occurrences === 0
            ? `The passage to replace was not found in ${path}.`
            : `The passage occurs ${occurrences} times in ${path}; include more context so it is unique.`,
        );
      }
      return this.writeCaptured(
        session,
        path,
        current.replace(find, () => replace),
      );
    });
  }

  /** Writes under a lock the caller already holds, capturing the change in the session. */
  private async writeCaptured(
    session: CheckpointSession,
    path: string,
    content: string,
  ): Promise<void> {
    const slug = session.book;
    await session.capture(needsReindex(path) ? 'book' : { paths: [path] }, () =>
      this.writeAndReindex(slug, path, content),
    );
    this.index.reconcile(slug);
  }

  /**
   * Writes a file and reindexes when its kind feeds a registry. A failed
   * reindex, even one killed after rewriting some registries, restores every
   * Markdown file in the book, so a rejected write leaves the book as it was.
   */
  private async writeAndReindex(slug: string, path: string, content: string): Promise<void> {
    const before = needsReindex(path) ? this.files.snapshot(slug) : null;
    this.files.write(slug, path, content);
    if (before === null) return;
    try {
      await this.cli.runOrThrow({ command: 'reindex', root: this.files.root(slug) });
    } catch (error) {
      for (const [file, bytes] of this.files.snapshot(slug)) {
        const previous = before.get(file);
        if (previous === undefined) this.files.remove(slug, file);
        else if (!previous.equals(bytes)) this.files.write(slug, file, previous);
      }
      for (const [file, bytes] of before) {
        if (this.files.readBytes(slug, file) === null) this.files.write(slug, file, bytes);
      }
      throw error;
    }
  }

  /**
   * Runs a story command for the agent. Read-only commands run directly;
   * commands that write run under the book lock inside the session, so the
   * files they change join the turn's checkpoint. Exit codes are returned as
   * data: the tool decides which of them are failures.
   */
  async runStoryForAgent(
    session: CheckpointSession,
    command: StoryCommandName,
    args: string[],
    options: StoryOptions,
  ): Promise<StoryRunResult> {
    const slug = session.book;
    const root = this.files.root(slug);
    const json = Object.hasOwn(STORY_COMMANDS[command].options, 'json');
    const request = { command, root, args, options, json };
    if (!storyCommandWrites(command, options)) return this.cli.run(request);
    return this.locks.run(slug, async () => {
      const result = await session.capture('book', () => this.cli.run(request));
      this.index.reconcile(slug);
      return result;
    });
  }

  /** Copies the book under its lock for a review-mode turn (ADR 0016). */
  stage(slug: string, stagingDir: string): Promise<StagedBook> {
    const root = this.files.root(slug);
    return this.locks.run(slug, () => StagedBook.create(slug, root, stagingDir, this.cli));
  }

  /**
   * Applies reviewed changes as one checkpoint. Every file must still be as
   * the turn found it; otherwise nothing is written and the conflicting
   * paths are named. Registries are regenerated by `story reindex`.
   */
  async applyStaged(
    slug: string,
    label: string,
    changes: readonly StagedChange[],
  ): Promise<Checkpoint | null> {
    const root = this.files.root(slug);
    return this.locks.run(slug, async () => {
      const changed = changes.filter((change) => {
        const current = this.files.readBytes(slug, change.path);
        return current === null || change.before === null
          ? current !== change.before
          : !current.equals(change.before);
      });
      if (changed.length > 0) {
        throw new ConflictError(
          'file_changed',
          `Changed since the agent proposed this: ${changed.map((change) => change.path).join(', ')}. Skip ${changed.length === 1 ? 'it' : 'them'} or ask the agent again.`,
        );
      }
      for (const change of changes) assertWritablePath(change.path);
      const { checkpoint } = await this.checkpoints.record(
        slug,
        label,
        'agent',
        'book',
        async () => {
          for (const change of changes) {
            if (change.after === null) this.files.remove(slug, change.path);
            else this.files.write(slug, change.path, change.after);
          }
          await this.cli.runOrThrow({ command: 'reindex', root });
        },
      );
      this.index.reconcile(slug);
      return checkpoint;
    });
  }

  /** Opens a checkpoint session: several locked changes recorded as one undoable entry. */
  startSession(slug: string, label: string, actor: CheckpointActor): CheckpointSession {
    this.files.root(slug);
    return this.checkpoints.session(slug, label, actor);
  }

  /** Finalizes a session's already ordered checkpoint under the book lock. */
  commitSession(session: CheckpointSession): Promise<Checkpoint | null> {
    return this.locks.run(session.book, () => {
      const checkpoint = session.commit();
      this.index.reconcile(session.book);
      return checkpoint;
    });
  }

  private async runEntityCommand(
    slug: string,
    label: string,
    request: {
      command: 'add' | 'rename' | 'move' | 'remove';
      args: string[];
      options?: StoryOptions;
    },
  ): Promise<StoryCommandOutcome> {
    const root = this.files.root(slug);
    return this.locks.run(slug, async () => {
      const { result, checkpoint } = await this.checkpoints.record(
        slug,
        label,
        'user',
        'book',
        () => this.cli.runOrThrow({ ...request, root }),
      );
      this.index.reconcile(slug);
      const validation = await this.cli.run({ command: 'validate', root, json: true });
      return {
        output: result.stdout.trim(),
        checkpointId: checkpoint?.id ?? null,
        validation: validation.envelope satisfies StoryEnvelope | null,
      };
    });
  }

  private summary(slug: string): BookSummary {
    const location = this.files.locate(slug);
    this.index.reconcile(slug);
    const story = this.index.frontmatter(slug, 'story.md');
    const latest = this.index.latestMtime(slug);
    return {
      slug,
      title: stringField(story, 'title') ?? slug,
      genre: stringField(story, 'genre'),
      status: stringField(story, 'status'),
      kind: location.kind,
      seriesId: location.seriesId,
      bookNumber: numberField(story, 'book-number'),
      follows: linkField(story, 'follows'),
      precedes: linkField(story, 'precedes'),
      counts: this.index.counts(slug),
      updatedAt: new Date(latest ?? Date.now()).toISOString(),
    };
  }

  /** A folder name for a new book: the title's slug, suffixed until unused. */
  private freeSlug(title: string): string {
    const stem = kebabId(title) || 'book';
    let candidate = stem;
    for (let suffix = 2; this.files.exists(candidate); suffix += 1) {
      candidate = `${stem}-${suffix}`;
    }
    return candidate;
  }
}

/** Story commands that always write, and flags that make read commands write. */
const WRITING_COMMANDS = new Set<string>([
  'add',
  'rename',
  'move',
  'remove',
  'reindex',
  'export',
  'build',
]);
const WRITING_FLAGS: Readonly<Record<string, readonly string[]>> = {
  passes: ['init', 'start', 'done'],
  wordcount: ['write'],
  progress: ['log'],
};

function storyCommandWrites(command: string, options: StoryOptions): boolean {
  if (WRITING_COMMANDS.has(command)) return true;
  return (WRITING_FLAGS[command] ?? []).some(
    (flag) => options[flag] !== undefined && options[flag] !== false,
  );
}

/** One entry to write into a book: its content, target kind, and provenance lines. */
export interface ImportEntry {
  title: string;
  markdown: string;
  kind: BookImportKind;
  provenance: readonly string[];
}

/** The first free `<base>`, `<base>-2`, … id in a directory, given paths already taken. */
function uniqueId(base: string, directory: string, taken: ReadonlySet<string>): string {
  let candidate = base;
  for (let suffix = 2; taken.has(`${directory}/${candidate}.md`); suffix += 1) {
    candidate = `${base}-${suffix}`;
  }
  return candidate;
}
