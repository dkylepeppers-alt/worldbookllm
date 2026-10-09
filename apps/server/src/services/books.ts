import { randomUUID } from 'node:crypto';

import {
  bookSlugSchema,
  type AddEntityInput,
  type BookImportKind,
  type BookImportPreview,
  type ChapterPlacement,
  type SourceOrigin,
  type SourcePreview,
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
  type CreateImportedBookInput,
  type NewBookImportPreview,
  createImportedBookSchema,
  type ManuscriptImportResult,
  type MoveEntityInput,
  type RenameEntityInput,
  type StoryCommandOutcome,
  type StoryEnvelope,
  type StoryOptions,
  type WriteBookFileInput,
  type BookBranches,
  type BookPlay,
  type PinnedIfid,
  type SetChapterChoicesInput,
} from '@worldbookllm/shared';

import { ConflictError, InvalidImportError, NotFoundError, StoryCommandError } from '../errors.js';
import type { BookFileStore } from '../story/book-files.js';
import {
  IMPORT_KIND_DIRECTORIES,
  archiveDocumentKind,
  chapterTitle,
  entityFileTitle,
  fillCreatedChapter,
  fillCreatedEntity,
  replaceChapterText,
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
import { buildPlay } from '../story/book-play.js';
import { branchGraph, setFrontmatterChoices } from '../story/branches.js';
import { removeSeriesLinks, setFrontmatterField } from '../story/frontmatter-edit.js';
import type {
  CheckpointActor,
  CheckpointService,
  CheckpointSession,
} from '../story/checkpoints.js';
import { KeyedMutex } from '../story/keyed-mutex.js';
import {
  looksLikeSeveralChapters,
  splitManuscript,
  type ManuscriptDocument,
} from '../story/manuscript-split.js';
import {
  discardStagedProject,
  promoteStagedProject,
  stageProjectFiles,
  PREVIEW_DOCUMENT_EXTENSIONS,
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

  /**
   * Runs a read-only check as JSON. Results without arguments are cached
   * until the book changes; `list` and `mentions` take theirs from `query`.
   */
  async check(
    slug: string,
    command: BookCheckCommand,
    fresh = false,
    query: BookCheckQueryArgs = {},
  ): Promise<BookCheckResult> {
    const root = this.files.root(slug);
    this.index.reconcile(slug);
    const revision = this.index.revision(slug);
    const args =
      command === 'list'
        ? checkArgs({ kind: query.kind })
        : command === 'mentions'
          ? checkArgs(query)
          : [];
    const options: StoryOptions =
      command === 'list' && query.where && query.where.length > 0 ? { where: query.where } : {};
    const cacheable = args.length === 0;
    const cached = cacheable ? this.checkCache.get(`${slug}:${command}`) : undefined;
    if (!fresh && cached && cached.revision === revision) return cached.result;
    const result = await this.cli.run({ command, root, args, options, json: true });
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
    if (cacheable) this.checkCache.set(`${slug}:${command}`, { revision, result: checked });
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

  /**
   * Converts an upload for review, suggesting the kind each entry should
   * become (ADR 0024, ADR 0026). A zip previews every convertible file in it,
   * in natural name order. A file with several chapter headings is split
   * into one chapter entry per chapter, as `story import` would split it.
   */
  async previewImport(slug: string, bytes: Buffer, fileName: string): Promise<BookImportPreview> {
    this.files.root(slug);
    const zip = /\.zip$/iu.test(fileName);
    const archive = zip ? await unpackProjectZip(bytes, PREVIEW_DOCUMENT_EXTENSIONS) : null;
    if (archive?.kind === 'project') {
      throw new InvalidImportError(
        'This zip is a whole story project (it has story.md). Import it from the library as a new book.',
      );
    }
    const preview = await previewDocuments(
      this.cli,
      archive?.files ?? [{ path: fileName, data: bytes }],
      { zipName: zip ? fileName : null, newBook: false, title: fileTitle(fileName) },
    );
    return {
      format: preview.format,
      origin: preview.origin,
      conversionNotes: capNotes([
        ...preview.notes,
        ...(archive?.skipped ?? []).map((entry) => `Skipped ${entry}.`),
      ]),
      entries: preview.entries,
    };
  }

  /**
   * Reads an upload for a new book without writing anything (ADR 0026). A
   * zipped story-skills project is reported for a whole-project import.
   * Anything else is split into chapters with `story import` in a temporary
   * folder, notes and entity files are suggested their kinds, and the
   * writer reviews it all before `createImportedBook` writes it.
   */
  async previewNewBook(
    bytes: Buffer,
    fileName: string,
    language?: string,
  ): Promise<NewBookImportPreview> {
    const zip = /\.zip$/iu.test(fileName);
    const archive = zip ? await unpackProjectZip(bytes, PREVIEW_DOCUMENT_EXTENSIONS) : null;
    if (archive?.kind === 'project') {
      const story = archive.files.find((file) => file.path === 'story.md');
      const fields = parseFrontmatter(story?.data.toString('utf8') ?? '').frontmatter;
      return {
        kind: 'project',
        title: stringField(fields, 'title') ?? fileTitle(fileName),
        files: archive.files.length,
        skipped: archive.skipped,
      };
    }
    const title = fileTitle(fileName);
    const preview = await previewDocuments(
      this.cli,
      archive?.files ?? [{ path: fileName, data: bytes }],
      { zipName: zip ? fileName : null, newBook: true, title, language },
    );
    if (preview.entries.length === 0) {
      throw new InvalidImportError('The upload has no text to import.');
    }
    return {
      kind: 'documents',
      title,
      format: preview.format,
      origin: preview.origin,
      conversionNotes: capNotes(preview.notes),
      entries: preview.entries,
      candidates: preview.candidates,
      skipped: archive?.skipped ?? [],
    };
  }

  /**
   * Creates a book from a reviewed import (ADR 0026): `story init` with the
   * writer's settings, then the entries as one checkpoint through the same
   * path that adds files to an existing book. The name candidates and skipped
   * files are kept in an `Import report` research note, so they outlast the
   * screen. If writing the entries fails, the new book goes to the trash.
   */
  async createImportedBook(input: CreateImportedBookInput): Promise<ManuscriptImportResult> {
    const {
      language,
      targetWords,
      import: imported,
      candidates,
      skipped,
      ...settings
    } = createImportedBookSchema.parse(input);
    const book = await this.create(settings);
    if (language !== undefined || targetWords !== undefined) {
      await this.locks.run(book.slug, () => {
        let story = this.files.readBytes(book.slug, 'story.md')?.toString('utf8') ?? '';
        if (language !== undefined) story = setFrontmatterField(story, 'language', language);
        if (targetWords !== undefined) {
          story = setFrontmatterField(story, 'target-words', String(targetWords));
        }
        this.files.write(book.slug, 'story.md', story);
      });
    }
    const report = importReport(candidates, skipped);
    try {
      const result = await this.importEntries(book.slug, {
        ...imported,
        entries: report === null ? imported.entries : [...imported.entries, report],
      });
      const chapters = imported.entries.filter((entry) => entry.kind === 'chapter').length;
      const others = imported.entries.length - chapters;
      const findings = result.validation?.diagnostics.length ?? 0;
      const lines = [
        `Created ${settings.title} with ${chapters} ${chapters === 1 ? 'chapter' : 'chapters'}` +
          (others > 0
            ? ` and ${others} ${others === 1 ? 'note or entry' : 'notes and entries'}.`
            : '.'),
        ...(report === null
          ? []
          : ['The suggested characters and places are saved in research/import-report.md.']),
        findings === 0
          ? 'story validate found no problems.'
          : `story validate reported ${findings}; see the Health tab.`,
      ];
      return { book: this.summary(book.slug), output: lines.join('\n') };
    } catch (error) {
      await this.trash(book.slug);
      throw error;
    }
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
    const importedAt = new Date().toISOString();
    const provenance = provenanceLines(input.origin, input.conversionNotes, importedAt);
    const label =
      input.entries.length === 1
        ? `Import ${input.entries[0]?.title ?? ''}`
        : `Import ${input.entries.length} entries`;
    return this.writeImports(
      slug,
      label,
      input.entries.map(({ origin, conversionNotes, ...entry }) => ({
        ...entry,
        provenance:
          origin || conversionNotes
            ? provenanceLines(
                origin ?? input.origin,
                conversionNotes ?? (origin ? [] : input.conversionNotes),
                importedAt,
              )
            : provenance,
      })),
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
    if (entries.some((entry) => entry.kind === 'chapter') && this.summary(slug).kind !== 'book') {
      throw new InvalidImportError(
        'A series bible holds shared canon, not chapters. Add chapters to one of the series books.',
      );
    }
    return this.locks.run(slug, async () => {
      this.index.reconcile(slug);
      const taken = new Set(this.index.list(slug).map((file) => file.path));
      const written: string[] = [];

      // Every placement names a chapter the book has now, or nothing is written.
      const chapters = this.chapterPaths(slug);
      for (const entry of entries) {
        const placement = entry.kind === 'chapter' ? entry.placement : undefined;
        if (placement && placement.at !== 'end' && !chapters.has(placement.chapter)) {
          throw new InvalidImportError(
            `The book has no chapter ${placement.chapter} to ${placement.at === 'replace' ? 'replace' : 'insert before'}.`,
          );
        }
      }
      // Chapter numbers as reviewed, before this import inserted any.
      const insertedBefore: number[] = [];

      const { checkpoint } = await this.checkpoints.record(
        slug,
        label,
        'user',
        'book',
        async () => {
          for (const entry of entries) {
            if (entry.kind === 'chapter') {
              written.push(await this.writeChapter(slug, root, entry, insertedBefore));
              continue;
            }
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
          if (entries.some((entry) => entry.kind === 'chapter')) {
            await this.cli.runOrThrow({ command: 'wordcount', root, options: { write: true } });
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

  /** The book's chapter files by number, read from their `chapter-NN.md` names. */
  private chapterPaths(slug: string): Map<number, string> {
    const chapters = new Map<number, string>();
    for (const file of this.files.listFiles(slug)) {
      const number = /^chapters\/chapter-(\d+)\.md$/u.exec(file.path)?.[1];
      if (number !== undefined) chapters.set(Number(number), file.path);
    }
    return chapters;
  }

  /**
   * Writes one imported chapter where the writer placed it. `at: 'end'` adds
   * it after the last chapter; `before` renumbers the later chapters with
   * `story move` (highest first, as the CLI requires) and adds it in the gap;
   * `replace` puts the prose into an existing chapter, keeping its
   * frontmatter. Placement numbers are the book's as reviewed:
   * `insertedBefore` holds the reviewed numbers this import has inserted
   * before, so later placements still find their chapter.
   */
  private async writeChapter(
    slug: string,
    root: string,
    entry: ImportEntry,
    insertedBefore: number[],
  ): Promise<string> {
    const placement = entry.placement ?? { at: 'end' };
    const title = chapterTitle(entry.title);
    const current = (reviewed: number) =>
      reviewed + insertedBefore.filter((number) => number <= reviewed).length;

    if (placement.at === 'replace') {
      const path = this.chapterPaths(slug).get(current(placement.chapter));
      const existing = path === undefined ? null : this.files.readBytes(slug, path);
      if (path === undefined || existing === null) {
        throw new InvalidImportError(`The book has no chapter ${placement.chapter} to replace.`);
      }
      this.files.write(
        slug,
        path,
        replaceChapterText(existing.toString('utf8'), entry.markdown, title, entry.provenance),
      );
      return path;
    }

    const options: StoryOptions = {};
    if (placement.at === 'before') {
      const target = current(placement.chapter);
      const chapters = this.chapterPaths(slug);
      if (!chapters.has(target)) {
        throw new InvalidImportError(
          `The book has no chapter ${placement.chapter} to insert before.`,
        );
      }
      const later = [...chapters.keys()].filter((number) => number >= target).sort((a, b) => b - a);
      for (const number of later) {
        const id = /chapter-\d+/u.exec(chapters.get(number)!)![0];
        await this.cli.runOrThrow({
          command: 'move',
          root,
          args: ['chapter', id],
          options: { number: String(number + 1) },
        });
      }
      options.number = String(target);
      insertedBefore.push(placement.chapter);
    }
    const added = await this.cli.runOrThrow({
      command: 'add',
      root,
      args: ['chapter', title],
      options,
      json: true,
    });
    const path = (added.envelope?.data as { file?: unknown } | undefined)?.file;
    const created = typeof path === 'string' ? this.files.readBytes(slug, path) : null;
    if (typeof path !== 'string' || created === null) {
      throw new StoryCommandError(1, 'story add chapter did not report the chapter it created');
    }
    this.files.write(
      slug,
      path,
      fillCreatedChapter(created.toString('utf8'), entry.markdown, title, entry.provenance, {
        numbered: entry.numbered,
        author: entry.author,
      }),
    );
    return path;
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
    if (archive.kind === 'documents') {
      throw new InvalidImportError(
        'This zip has no story.md. Preview it for review instead of importing it whole.',
      );
    }
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

  /** The chapters as a branch graph: their choices, the start, endings, and what is reachable. */
  branches(slug: string): Promise<BookBranches> {
    return this.locks.run(slug, () => this.readBranches(slug));
  }

  private readBranches(slug: string): BookBranches {
    this.index.reconcile(slug);
    const chapters = this.index
      .list(slug)
      .filter((file) => file.kind === 'chapter' && file.entityId !== null)
      .map((file) => {
        const bytes = this.files.readBytes(slug, file.path);
        return {
          id: file.entityId!,
          title: file.title,
          path: file.path,
          hash: file.hash,
          frontmatter: bytes === null ? null : parseFrontmatter(bytes.toString('utf8')).frontmatter,
        };
      });
    const story = this.files.readBytes(slug, 'story.md')?.toString('utf8') ?? '';
    const ifid = parseFrontmatter(story).frontmatter?.ifid;
    return branchGraph(chapters, typeof ifid === 'string' && ifid.trim() !== '' ? ifid : null);
  }

  /** Replaces a chapter's `choices` as one checkpointed edit of its file. */
  async setChapterChoices(
    slug: string,
    chapterId: string,
    input: SetChapterChoicesInput,
  ): Promise<BookBranches> {
    const chapter = (await this.branches(slug)).chapters.find((entry) => entry.id === chapterId);
    if (chapter === undefined) throw new NotFoundError(`Chapter ${chapterId} was not found`);
    const current = this.files.readBytes(slug, chapter.path);
    if (current === null || sha256(current) !== input.expectedHash) {
      throw new ConflictError(
        'file_changed',
        `${chapter.path} changed since it was loaded. Reload to see the latest choices.`,
      );
    }
    const content = setFrontmatterChoices(current.toString('utf8'), input.choices);
    await this.writeFile(slug, chapter.path, { content, expectedHash: input.expectedHash });
    return this.branches(slug);
  }

  /** The book as a playable ink story: the ink build, compiled with inkjs. */
  play(slug: string): Promise<BookPlay> {
    return this.locks.run(slug, () => {
      const chapters = this.readBranches(slug).chapters.map(({ id, title }) => ({ id, title }));
      return buildPlay(this.cli, this.files.root(slug), chapters);
    });
  }

  /**
   * Pins the story's IFID in story.md, so retitling the book keeps the same
   * identity. It keeps the IFID earlier builds derived; when the book cannot
   * build yet (a choice leads nowhere), a fresh one.
   */
  pinIfid(slug: string): Promise<PinnedIfid> {
    return this.locks.run(slug, async () => {
      const story = this.files.readBytes(slug, 'story.md')?.toString('utf8');
      if (story === undefined) throw new NotFoundError(`${slug} has no story.md`);
      const pinned = parseFrontmatter(story).frontmatter?.ifid;
      if (typeof pinned === 'string' && pinned.trim() !== '') return { ifid: pinned };
      let ifid: string;
      try {
        ifid = (await buildPlay(this.cli, this.files.root(slug), [])).ifid;
      } catch (error) {
        if (!(error instanceof StoryCommandError) && !(error instanceof ConflictError)) throw error;
        ifid = '';
      }
      if (!/^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/iu.test(ifid)) {
        ifid = randomUUID();
      }
      ifid = ifid.toUpperCase();
      const content = setFrontmatterField(story, 'ifid', ifid);
      await this.checkpoints.record(
        slug,
        'Pin the story IFID',
        'user',
        needsReindex('story.md') ? 'book' : { paths: ['story.md'] },
        () => this.writeAndReindex(slug, 'story.md', content),
      );
      this.index.reconcile(slug);
      return { ifid };
    });
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
  'split',
  'merge',
  'reindex',
  'export',
  'build',
]);
const WRITING_FLAGS: Readonly<Record<string, readonly string[]>> = {
  doctor: ['fix'],
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

interface BookCheckQueryArgs {
  kind?: string;
  id?: string;
  where?: string[];
}

/** Positional arguments for `list <kind>` and `mentions <kind> <id>`. */
function checkArgs(query: BookCheckQueryArgs): string[] {
  if (query.kind === undefined) return [];
  return query.id === undefined ? [query.kind] : [query.kind, query.id];
}

/** Sorts `chapter-2` before `chapter-10`, as `story import` reads a folder. */
const naturalOrder = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/**
 * The provenance of one file inside an uploaded zip, `<zip>: <path>`, within
 * the 255-character limit. The zip name gives way first and then the start
 * of the path, so the file's own name, which tells entries apart, is kept.
 */
function archiveOrigin(zipName: string, path: string, mediaType: string): SourceOrigin {
  const room = 255 - ': '.length - path.length;
  const fileName =
    room >= 1
      ? `${zipName.length <= room ? zipName : `${zipName.slice(0, room - 1)}…`}: ${path}`
      : `…${path.slice(-254)}`;
  return { type: 'file', fileName, mediaType };
}

/** The media type a converter found for an archive file. */
function mediaTypeOf(preview: SourcePreview): string {
  return 'mediaType' in preview.origin ? preview.origin.mediaType : 'text/plain';
}

/** One archive file converted for import, or null when it has no readable text. */
async function convertArchiveFile(path: string, data: Buffer): Promise<SourcePreview | null> {
  try {
    const preview = await convertUpload(data, path.slice(path.lastIndexOf('/') + 1));
    return preview.entries.length > 0 ? preview : null;
  } catch (error) {
    if (error instanceof InvalidImportError) return null;
    throw error;
  }
}

/** At most 20 notes of at most 500 characters, as the preview schema allows. */
function capNotes(notes: readonly string[]): string[] {
  const clipped = notes.map((note) => (note.length > 500 ? `${note.slice(0, 499)}…` : note));
  return clipped.length <= 20
    ? clipped
    : [...clipped.slice(0, 19), `…and ${clipped.length - 19} more notes.`];
}

/** A book title from an upload's name: the name without its extension. */
function fileTitle(fileName: string): string {
  return fileName.replace(/\.[^.]+$/u, '').trim() || 'Imported manuscript';
}

/** File formats whose text is a manuscript `story import` can split. */
const SPLITTABLE_FORMATS = new Set<SourcePreview['format']>(['markdown', 'text', 'html', 'pdf']);

interface DocumentsPreview {
  format: SourcePreview['format'];
  origin: SourceOrigin;
  entries: BookImportPreview['entries'];
  notes: string[];
  candidates: Array<{ name: string; count: number }>;
}

/**
 * The shared review step of every import (ADR 0026): converts each file,
 * suggests each entry's kind, and splits manuscript files into chapters
 * with `story import`, all in natural path order and without writing
 * anything. For a new book, every file that is not a note, entity, or
 * lorebook is manuscript and is split. For an existing book, only a file
 * that is a chapter with several chapter headings is split; others stay
 * one entry each.
 */
async function previewDocuments(
  cli: StoryCli,
  files: ReadonlyArray<{ path: string; data: Buffer }>,
  options: { zipName: string | null; newBook: boolean; title: string; language?: string },
): Promise<DocumentsPreview> {
  const ordered = [...files].sort((a, b) => naturalOrder.compare(a.path, b.path));
  const notes: string[] = [];
  type Draft = BookImportPreview['entries'][number];
  // Each file's entries, or the manuscript text to split into its chapters.
  const slots: Array<{ entries: Draft[] } | { split: ManuscriptDocument; base: Draft }> = [];
  let format: SourcePreview['format'] = 'markdown';
  let firstOrigin: SourceOrigin | null = null;

  for (const file of ordered) {
    const converted = await convertArchiveFile(file.path, file.data);
    if (converted === null) {
      notes.push(`Skipped ${file.path}: it has no readable text.`);
      continue;
    }
    format = converted.format;
    const origin =
      options.zipName === null
        ? converted.origin
        : archiveOrigin(options.zipName, file.path, mediaTypeOf(converted));
    firstOrigin ??= origin;
    const shared = { origin, conversionNotes: converted.conversionNotes };
    const entries: Draft[] = converted.entries.map((entry) => {
      const suggestion = suggestImportKind(entry.markdown, converted.format, {
        title: entry.title,
        path: file.path,
      });
      const kind =
        options.newBook && SPLITTABLE_FORMATS.has(converted.format)
          ? archiveDocumentKind(file.path, entry.markdown)
          : suggestion.suggestedKind;
      return { ...entry, ...suggestion, suggestedKind: kind, ...shared };
    });
    const only = entries.length === 1 ? entries[0]! : null;
    const text = ['markdown', 'text'].includes(converted.format)
      ? file.data.toString('utf8')
      : (only?.markdown ?? '');
    const split =
      only !== null &&
      only.suggestedKind === 'chapter' &&
      SPLITTABLE_FORMATS.has(converted.format) &&
      (options.newBook || looksLikeSeveralChapters(text));
    if (split) {
      // story import reads .md, .markdown, and .txt; converted HTML and PDF are Markdown.
      const name = /\.(md|markdown|txt)$/iu.test(file.path) ? file.path : `${file.path}.md`;
      slots.push({ split: { name, text }, base: only });
    } else {
      slots.push({ entries });
    }
  }

  const documents = slots.flatMap((slot) => ('split' in slot ? [slot.split] : []));
  const { chapters, candidates } = await splitManuscript(cli, documents, {
    title: options.title,
    language: options.language,
  });
  const entries = slots.flatMap((slot) => {
    if (!('split' in slot)) return slot.entries;
    return chapters
      .filter((chapter) => chapter.source === slot.split.name)
      .map((chapter): Draft => ({
        ...slot.base,
        title: chapter.title,
        markdown: chapter.markdown,
        ...(chapter.numbered ? {} : { numbered: false }),
        ...(chapter.author === null ? {} : { author: chapter.author }),
      }));
  });
  if (entries.length > 1_000) {
    throw new InvalidImportError('The upload holds more than 1,000 entries to import.');
  }
  return {
    format: options.zipName === null ? format : 'markdown',
    origin:
      options.zipName === null && firstOrigin !== null
        ? firstOrigin
        : { type: 'file', fileName: options.zipName ?? 'upload', mediaType: 'application/zip' },
    entries,
    notes,
    candidates,
  };
}

/**
 * The research note that keeps an import's suggested names and skipped
 * files in the book, or null when there is nothing to keep.
 */
function importReport(
  candidates: ReadonlyArray<{ name: string; count: number }>,
  skipped: readonly string[],
): ImportEntryInput | null {
  if (candidates.length === 0 && skipped.length === 0) return null;
  const lines: string[] = [];
  if (candidates.length > 0) {
    lines.push(
      '## Suggested characters and places',
      '',
      'Names the manuscript repeats, found by `story import`. Review them, then create the ones that belong in the bible with `story add`.',
      '',
      ...candidates.map(
        ({ name, count }) => `- ${name} (${count} ${count === 1 ? 'mention' : 'mentions'})`,
      ),
    );
  }
  if (skipped.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push('## Skipped files', '', ...skipped.map((entry) => `- ${entry}`));
  }
  return { title: 'Import report', markdown: lines.join('\n'), kind: 'research' };
}

type ImportEntryInput = CreateBookImportInput['entries'][number];

/** One entry to write into a book: its content, target kind, and provenance lines. */
export interface ImportEntry {
  title: string;
  markdown: string;
  kind: BookImportKind;
  provenance: readonly string[];
  /** Chapters only: where it goes, whether it is numbered, and its writer. */
  placement?: ChapterPlacement;
  numbered?: boolean;
  author?: string | string[];
}

/** The first free `<base>`, `<base>-2`, … id in a directory, given paths already taken. */
function uniqueId(base: string, directory: string, taken: ReadonlySet<string>): string {
  let candidate = base;
  for (let suffix = 2; taken.has(`${directory}/${candidate}.md`); suffix += 1) {
    candidate = `${base}-${suffix}`;
  }
  return candidate;
}
