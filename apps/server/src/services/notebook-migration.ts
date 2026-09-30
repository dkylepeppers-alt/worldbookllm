import { existsSync, readFileSync, renameSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import type Database from 'better-sqlite3';
import matter from 'gray-matter';

import {
  sourceOriginSchema,
  type NotebookMigrationReport,
  type SourceOrigin,
} from '@worldbookllm/shared';

import type { AgentService, LegacyChatMessage } from '../agent/agent-service.js';
import { UnsafePathError } from '../errors.js';
import { quoted, provenanceLines } from '../story/book-import.js';
import type { BookService, ImportEntry } from './books.js';
import type { SettingsService } from './settings.js';

export interface NotebookMigrationOutcome {
  notebookId: string;
  notebookName: string;
  bookSlug: string;
  sourceCount: number;
  fileCount: number;
  chatCount: number;
  /** Why the sources could not be written; the book then exists without them. */
  error: string | null;
  /** Sources whose files could not be read and were left out. */
  skippedSources: Array<{ sourceId: string; title: string; reason: string }>;
}

interface NotebookRow {
  id: string;
  name: string;
}

interface SourceRow {
  id: string;
  title: string;
  file_path: string;
  origin_json: string;
  conversion_notes_json: string;
  category: string | null;
  tags_json: string;
  created_at: string;
}

interface ChatRow {
  id: string;
  title: string;
  source_ids_json: string;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  role: 'user' | 'assistant';
  content: string;
  reasoning: string | null;
  status: 'complete' | 'interrupted' | 'error' | 'streaming';
  context_json: string;
  created_at: string;
}

interface MigrationRow {
  notebook_id: string;
  book_slug: string;
  migrated_at: string;
  source_count: number;
  file_count: number;
  chat_count: number;
  error: string | null;
  notebook_name: string | null;
}

/** Keys the notebook app wrote into a source file's frontmatter; anything else is the writer's. */
const MANAGED_KEYS = new Set([
  'id',
  'notebookId',
  'title',
  'origin',
  'conversionNotes',
  'category',
  'tags',
  'createdAt',
  'updatedAt',
]);

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function stringList(text: string): string[] {
  const value = parseJson(text);
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/** The provider request body a notebook exchange recorded, if its snapshot kept one. */
function recordedRequestBody(contextJson: string): Record<string, unknown> | null {
  const context = parseJson(contextJson);
  if (typeof context !== 'object' || context === null) return null;
  const body = (context as { effectiveRequestBody?: unknown }).effectiveRequestBody;
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

/**
 * The one-time move from notebooks to story-skills books (ADR 0014 decision
 * 6, ADR 0017), run when the server starts. Each notebook becomes a book
 * created with `story init`. Each source becomes a research note carrying its
 * provenance, its import time, and its category and tags as the flat keys
 * `legacy-category` and `tags`. Each chat becomes an agent chat on that book:
 * its first message notes which research notes its selected sources became,
 * and each response keeps the provider request body its exchange recorded,
 * shown by the step inspector.
 *
 * It reads the notebook-era tables and files directly; nothing there is
 * modified. It is idempotent: a notebook with a row in `notebook_migrations`
 * is skipped. Once every notebook has moved, `data/notebooks/` is renamed to
 * `data/notebooks.migrated/`, and the report is shown to the writer once.
 */
export class NotebookMigrationService {
  private readonly dataDir: string;

  constructor(
    private readonly db: Database.Database,
    private readonly books: BookService,
    private readonly agent: AgentService,
    private readonly settings: SettingsService,
    dataDir: string,
  ) {
    this.dataDir = resolve(dataDir);
  }

  /** Book slugs already created from notebooks, by notebook id. */
  migrated(): Map<string, string> {
    const rows = this.db
      .prepare('SELECT notebook_id, book_slug FROM notebook_migrations')
      .all() as Array<Pick<MigrationRow, 'notebook_id' | 'book_slug'>>;
    return new Map(rows.map((row) => [row.notebook_id, row.book_slug]));
  }

  /** Migrates any notebooks not yet moved, then archives the notebook folder. */
  async run(): Promise<NotebookMigrationOutcome[]> {
    const outcomes = await this.migrateAll();
    this.archive();
    return outcomes;
  }

  async migrateAll(): Promise<NotebookMigrationOutcome[]> {
    const done = this.migrated();
    const outcomes: NotebookMigrationOutcome[] = [];
    const notebooks = this.db
      .prepare('SELECT id, name FROM notebooks ORDER BY created_at, id')
      .all() as NotebookRow[];
    for (const notebook of notebooks) {
      if (done.has(notebook.id)) continue;
      outcomes.push(await this.migrateNotebook(notebook));
    }
    return outcomes;
  }

  report(): NotebookMigrationReport {
    const rows = this.db
      .prepare(
        `SELECT notebook_migrations.*, notebooks.name AS notebook_name
         FROM notebook_migrations
         LEFT JOIN notebooks ON notebooks.id = notebook_migrations.notebook_id
         ORDER BY notebook_migrations.rowid`,
      )
      .all() as MigrationRow[];
    return {
      entries: rows.map((row) => ({
        notebookName: row.notebook_name ?? row.book_slug,
        bookSlug: row.book_slug,
        migratedAt: row.migrated_at,
        sourceCount: row.source_count,
        fileCount: row.file_count,
        chatCount: row.chat_count,
        error: row.error,
      })),
      seen: this.settings.notebookMigrationSeen(),
    };
  }

  /** Renames data/notebooks/ once every notebook in it has moved into a book. */
  private archive(): void {
    const folder = join(this.dataDir, 'notebooks');
    if (!existsSync(folder)) return;
    const pending = this.db
      .prepare(
        'SELECT COUNT(*) FROM notebooks WHERE id NOT IN (SELECT notebook_id FROM notebook_migrations)',
      )
      .pluck()
      .get() as number;
    if (pending > 0) return;
    let target = join(this.dataDir, 'notebooks.migrated');
    if (existsSync(target)) {
      target = `${target}-${new Date().toISOString().replaceAll(':', '-')}`;
    }
    renameSync(folder, target);
  }

  private readSource(row: SourceRow): { title: string; content: string } {
    const absolute = resolve(this.dataDir, row.file_path);
    const fromRoot = relative(this.dataDir, absolute);
    if (fromRoot.startsWith(`..${sep}`) || fromRoot === '..') {
      throw new UnsafePathError(row.file_path);
    }
    const parsed = matter(readFileSync(absolute, 'utf8'));
    const data = parsed.data as Record<string, unknown>;
    const extra = Object.fromEntries(
      Object.entries(data).filter(([key]) => !MANAGED_KEYS.has(key)),
    );
    const content =
      Object.keys(extra).length === 0 ? parsed.content : matter.stringify(parsed.content, extra);
    const title =
      typeof data.title === 'string' && data.title.trim() !== '' ? data.title : row.title;
    return { title, content };
  }

  private async migrateNotebook(notebook: NotebookRow): Promise<NotebookMigrationOutcome> {
    const book = await this.books.create({ title: notebook.name });
    const entries: ImportEntry[] = [];
    const entrySources: string[] = [];
    const skippedSources: NotebookMigrationOutcome['skippedSources'] = [];
    const sources = this.db
      .prepare('SELECT * FROM sources WHERE notebook_id = ? ORDER BY created_at, id')
      .all(notebook.id) as SourceRow[];

    for (const source of sources) {
      try {
        const { title, content } = this.readSource(source);
        const origin: SourceOrigin = sourceOriginSchema.parse(parseJson(source.origin_json));
        const provenance = provenanceLines(
          origin,
          stringList(source.conversion_notes_json),
          source.created_at,
        );
        if (source.category) provenance.push(`legacy-category: ${quoted(source.category)}`);
        const tags = stringList(source.tags_json);
        if (tags.length > 0) provenance.push('tags:', ...tags.map((tag) => `  - ${quoted(tag)}`));
        entries.push({ title, markdown: content, kind: 'research', provenance });
        entrySources.push(source.id);
      } catch (error) {
        skippedSources.push({
          sourceId: source.id,
          title: source.title,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    let failure: string | null = null;
    const pathsBySource = new Map<string, string>();
    if (entries.length > 0) {
      try {
        const result = await this.books.writeImports(
          book.slug,
          `Migrate notebook ${notebook.name}`,
          entries,
        );
        result.files.forEach((path, index) => {
          const sourceId = entrySources[index];
          if (sourceId !== undefined) pathsBySource.set(sourceId, path);
        });
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
      }
    }

    const chatCount = this.migrateChats(notebook, book.slug, pathsBySource);

    this.db
      .prepare(
        `INSERT INTO notebook_migrations
           (notebook_id, book_slug, migrated_at, source_count, file_count, chat_count, error)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        notebook.id,
        book.slug,
        new Date().toISOString(),
        sources.length,
        pathsBySource.size,
        chatCount,
        failure,
      );

    return {
      notebookId: notebook.id,
      notebookName: notebook.name,
      bookSlug: book.slug,
      sourceCount: sources.length,
      fileCount: pathsBySource.size,
      chatCount,
      error: failure,
      skippedSources,
    };
  }

  /** Carries each notebook chat over as an agent chat on the new book. */
  private migrateChats(
    notebook: NotebookRow,
    book: string,
    pathsBySource: ReadonlyMap<string, string>,
  ): number {
    const chats = this.db
      .prepare('SELECT * FROM chats WHERE notebook_id = ? ORDER BY created_at, id')
      .all(notebook.id) as ChatRow[];
    for (const chat of chats) {
      const rows = this.db
        .prepare(
          'SELECT role, content, reasoning, status, context_json, created_at FROM messages WHERE chat_id = ? ORDER BY seq',
        )
        .all(chat.id) as MessageRow[];
      const notes = stringList(chat.source_ids_json)
        .map((id) => pathsBySource.get(id))
        .filter((path): path is string => path !== undefined);
      const origin = [
        `[This chat began in the notebook "${notebook.name}" before it became this book.`,
        notes.length === 0
          ? 'It had no sources selected.]'
          : `The sources it had selected are now these research notes: ${notes.join(', ')}.]`,
      ].join(' ');
      let noted = false;
      const messages: LegacyChatMessage[] = rows.map((row) => {
        if (row.role === 'user') {
          const note = noted ? null : origin;
          noted = true;
          return { role: 'user', content: row.content, note, createdAt: row.created_at };
        }
        const requestBody = recordedRequestBody(row.context_json);
        return {
          role: 'assistant',
          content: row.content,
          reasoning: row.reasoning,
          status: row.status === 'streaming' ? 'interrupted' : row.status,
          requestBody,
          createdAt: row.created_at,
        };
      });
      this.agent.importLegacyChat(book, {
        title: chat.title,
        createdAt: chat.created_at,
        updatedAt: chat.updated_at,
        messages,
      });
    }
    return chats.length;
  }
}
