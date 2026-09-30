import {
  BOOK_ENTITY_KINDS,
  type AddEntityInput,
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
  type MoveEntityInput,
  type RenameEntityInput,
  type StoryCommandOutcome,
  type StoryEnvelope,
  type StoryOptions,
  type WriteBookFileInput,
} from '@worldbookllm/shared';

import {
  ConflictError,
  NotFoundError,
  ReadOnlyBookPathError,
  StoryCommandError,
} from '../errors.js';
import type { BookFileStore } from '../story/book-files.js';
import { sha256 } from '../story/book-files.js';
import { parseFrontmatter, type BookIndex } from '../story/book-index.js';
import { classifyBookPath } from '../story/book-paths.js';
import type { CheckpointActor, CheckpointService } from '../story/checkpoints.js';
import { KeyedMutex } from '../story/keyed-mutex.js';
import type { StoryCli } from '../story/story-cli.js';

const MAX_SLUG_LENGTH = 80;
/** Lock key for book creation; the NUL byte keeps it apart from every book slug. */
const CREATE_LOCK = '\0create';

/**
 * File kinds whose edits change what `story reindex` writes into the
 * registries (entity titles and fields, the story title), so a direct edit
 * reindexes in the same checkpoint.
 */
const REINDEXED_KINDS = new Set<string>([...BOOK_ENTITY_KINDS, 'story']);

/** Kebab-case folder name for a title, as story-skills derives ids; '' when nothing is left. */
function kebab(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/^-+|-+$/gu, '');
}

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

  async trash(slug: string): Promise<void> {
    await this.locks.run(slug, () => {
      this.files.trash(slug);
      this.index.removeBook(slug);
      this.checkpoints.removeBook(slug);
      this.checkCache.delete(slug);
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
    const stem = kebab(title) || 'book';
    let candidate = stem;
    for (let suffix = 2; this.files.exists(candidate); suffix += 1) {
      candidate = `${stem}-${suffix}`;
    }
    return candidate;
  }
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
