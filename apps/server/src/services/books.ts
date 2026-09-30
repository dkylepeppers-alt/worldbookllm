import {
  BOOK_ENTITY_KINDS,
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
  type CreateBookInput,
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

import {
  ConflictError,
  InvalidImportError,
  NotFoundError,
  ReadOnlyBookPathError,
  StoryCommandError,
} from '../errors.js';
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
import { parseFrontmatter, type BookIndex } from '../story/book-index.js';
import { classifyBookPath } from '../story/book-paths.js';
import type {
  CheckpointActor,
  CheckpointService,
  CheckpointSession,
} from '../story/checkpoints.js';
import { KeyedMutex } from '../story/keyed-mutex.js';
import type { StoryCli, StoryRunResult } from '../story/story-cli.js';
import { STORY_COMMANDS, type StoryCommandName } from '../story/story-commands.js';
import { convertUpload } from './converters/index.js';

/** Lock key for book creation; the NUL byte keeps it apart from every book slug. */
const CREATE_LOCK = '\0create';

/** Agent chats tied to a book. Attached after both services exist (they refer to each other). */
export interface BookChatLifecycle {
  assertIdle(book: string): void;
  removeForBook(book: string): void;
}

/**
 * File kinds whose edits change what `story reindex` writes into the
 * registries (entity titles and fields, the story title), so a direct edit
 * reindexes in the same checkpoint.
 */
const REINDEXED_KINDS = new Set<string>([...BOOK_ENTITY_KINDS, 'story']);

function stringField(frontmatter: Record<string, unknown> | null, key: string): string | null {
  const value = frontmatter?.[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function numberField(frontmatter: Record<string, unknown> | null, key: string): number | null {
  const value = frontmatter?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
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
      this.chatLifecycle?.assertIdle(slug);
      this.files.trash(slug);
      this.index.removeBook(slug);
      this.checkpoints.removeBook(slug);
      this.checkCache.delete(slug);
      this.chatLifecycle?.removeForBook(slug);
    });
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
      const reindex = REINDEXED_KINDS.has(classifyBookPath(path).kind);
      const root = this.files.root(slug);
      const { checkpoint } = await this.checkpoints.record(
        slug,
        label,
        actor,
        reindex ? 'book' : { paths: [path] },
        async () => {
          this.files.write(slug, path, input.content);
          if (reindex) await this.cli.runOrThrow({ command: 'reindex', root });
        },
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

  async check(slug: string, command: BookCheckCommand): Promise<BookCheckResult> {
    const root = this.files.root(slug);
    this.index.reconcile(slug);
    const revision = this.index.revision(slug);
    const cached = this.checkCache.get(`${slug}:${command}`);
    if (cached && cached.revision === revision) return cached.result;
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
  async writeInSession(session: CheckpointSession, path: string, content: string): Promise<void> {
    assertWritablePath(path);
    const slug = session.book;
    await this.locks.run(slug, () => this.writeCaptured(session, path, content));
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
      const occurrences = current.split(find).length - 1;
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
    const root = this.files.root(slug);
    const reindex = REINDEXED_KINDS.has(classifyBookPath(path).kind);
    await session.capture(reindex ? 'book' : { paths: [path] }, async () => {
      this.files.write(slug, path, content);
      if (reindex) await this.cli.runOrThrow({ command: 'reindex', root });
    });
    this.index.reconcile(slug);
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

  /** Opens a checkpoint session: several locked changes recorded as one undoable entry. */
  startSession(slug: string, label: string, actor: CheckpointActor): CheckpointSession {
    this.files.root(slug);
    return this.checkpoints.session(slug, label, actor);
  }

  /**
   * Stores a session's changes as one checkpoint under the book lock, after
   * dropping any path someone else changed since it was captured.
   */
  commitSession(session: CheckpointSession): Promise<Checkpoint | null> {
    return this.locks.run(session.book, () => {
      session.omitStale((path) => this.files.readBytes(session.book, path));
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
    this.files.root(slug);
    this.index.reconcile(slug);
    const story = this.index.frontmatter(slug, 'story.md');
    const latest = this.index.latestMtime(slug);
    return {
      slug,
      title: stringField(story, 'title') ?? slug,
      genre: stringField(story, 'genre'),
      status: stringField(story, 'status'),
      seriesId: stringField(story, 'series'),
      bookNumber: numberField(story, 'book-number'),
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

export function storyCommandWrites(command: string, options: StoryOptions): boolean {
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

/**
 * Files the app may write directly: Markdown only, never a generated
 * registry (those come from `story reindex`) and never into `dist/`.
 */
function assertWritablePath(path: string): void {
  if (!path.endsWith('.md'))
    throw new ReadOnlyBookPathError(path, 'only Markdown files are edited');
  if (path === 'dist' || path.startsWith('dist/')) {
    throw new ReadOnlyBookPathError(path, 'dist/ holds build output');
  }
  if (classifyBookPath(path).kind === 'registry') {
    throw new ReadOnlyBookPathError(path, 'registries are generated by story reindex');
  }
}
