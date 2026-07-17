import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import {
  type CreateSource,
  type CreateSourceInput,
  type PatchSource,
  type SourceDetail,
  type SourceMetadata,
  type SourceSearchResult,
  sourceCategorySchema,
  sourceDetailSchema,
  sourceMetadataSchema,
  sourceOriginSchema,
  sourceTagsSchema,
  conversionNotesSchema,
  createSourceSchema,
  patchSourceSchema,
} from '@worldbookllm/shared';
import type Database from 'better-sqlite3';

import type { SourceRow } from '../db/types.js';
import { InvalidStoredDataError, NotFoundError } from '../errors.js';
import { type ReadSourceFile, SourceFileStore } from '../files/source-files.js';
import { SourceSearchIndex } from './source-search.js';

/**
 * Filter/search need stable casing, so tags are lowercased and deduped on
 * write. Unicode lowercasing can lengthen a string (e.g. İ → i + combining
 * dot), so the result is re-capped at the schema's 50-character limit to keep
 * stored data valid.
 */
function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.toLowerCase().slice(0, 50)))];
}

function mapSource(row: SourceRow): SourceMetadata {
  try {
    const origin = sourceOriginSchema.parse(JSON.parse(row.origin_json));
    const conversionNotes = conversionNotesSchema.parse(JSON.parse(row.conversion_notes_json));
    const category = sourceCategorySchema.nullable().parse(row.category);
    const tags = sourceTagsSchema.parse(JSON.parse(row.tags_json));
    return sourceMetadataSchema.parse({
      id: row.id,
      notebookId: row.notebook_id,
      title: row.title,
      slug: row.slug,
      filePath: row.file_path,
      origin,
      conversionNotes,
      category,
      tags,
      wordCount: row.word_count,
      contentHash: row.content_hash,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  } catch (error) {
    throw new InvalidStoredDataError(`Source ${row.id} has invalid stored metadata`, {
      cause: error,
    });
  }
}

export class SourceService {
  private readonly searchIndex: SourceSearchIndex;

  constructor(
    private readonly db: Database.Database,
    private readonly sourceFiles: SourceFileStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.searchIndex = new SourceSearchIndex(db);
  }

  private getRow(id: string): SourceRow {
    const row = this.db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as
      SourceRow | undefined;
    if (!row) throw new NotFoundError(`Source ${id} was not found`);
    return row;
  }

  private requireNotebook(id: string): void {
    const exists = this.db.prepare('SELECT 1 FROM notebooks WHERE id = ?').get(id);
    if (!exists) throw new NotFoundError(`Notebook ${id} was not found`);
  }

  private validateAssistantResponseOrigin(
    notebookId: string,
    origin: CreateSource['origin'],
  ): void {
    if (origin.type !== 'assistant-response') return;
    const relationship = this.db
      .prepare(
        `SELECT messages.chat_id, messages.role, messages.content, chats.notebook_id
         FROM messages
         JOIN chats ON chats.id = messages.chat_id
         WHERE messages.id = ?`,
      )
      .get(origin.messageId) as
      | { chat_id: string; role: 'user' | 'assistant'; content: string; notebook_id: string }
      | undefined;
    if (
      relationship?.chat_id !== origin.chatId ||
      relationship.role !== 'assistant' ||
      relationship.content.trim().length === 0 ||
      relationship.notebook_id !== notebookId
    ) {
      throw new NotFoundError('Assistant response was not found in this notebook');
    }
  }

  list(notebookId: string): SourceMetadata[] {
    this.requireNotebook(notebookId);
    const rows = this.db
      .prepare('SELECT * FROM sources WHERE notebook_id = ? ORDER BY created_at ASC, id ASC')
      .all(notebookId) as SourceRow[];
    return rows.map(mapSource);
  }

  /** Ranked full-text search across one notebook's sources (titles weigh more). */
  search(notebookId: string, query: string): SourceSearchResult[] {
    this.requireNotebook(notebookId);
    return this.searchIndex
      .search(notebookId, query)
      .map(({ row, excerpt }) => ({ ...mapSource(row), excerpt }));
  }

  /**
   * Reconciles the whole index with the files on disk: every source file is
   * read, rows whose file drifted while the app was closed are refreshed
   * (row + FTS entry, same as the on-read reconciliation), and rows missing
   * from the FTS table (a pre-M3 data dir, or an index that diverged) are
   * indexed. Unreadable files are reported and skipped so one corrupt source
   * cannot stop startup; ordinary reads reconcile them later.
   */
  ensureSearchIndex(onError?: (sourceId: string, error: unknown) => void): void {
    const indexed = new Set(this.searchIndex.indexedSourceIds());
    const rows = this.db.prepare('SELECT * FROM sources').all() as SourceRow[];
    for (const row of rows) {
      try {
        const file = this.sourceFiles.read(row.file_path);
        this.assertFileIdentity(row, file);
        const drifted = this.reconcileFromFile(row, file);
        if (!drifted && !indexed.has(row.id)) {
          this.searchIndex.index({
            sourceId: row.id,
            notebookId: row.notebook_id,
            title: file.title,
            content: file.content,
          });
        }
      } catch (error) {
        onError?.(row.id, error);
      }
    }
  }

  create(notebookId: string, input: CreateSourceInput): SourceMetadata {
    const normalized = createSourceSchema.parse(input);
    const tags = normalizeTags(normalized.tags);
    const id = randomUUID();
    const timestamp = this.now();
    let stored: ReturnType<SourceFileStore['write']> | undefined;

    try {
      return this.db.transaction(() => {
        this.requireNotebook(notebookId);
        this.validateAssistantResponseOrigin(notebookId, normalized.origin);
        stored = this.sourceFiles.write({
          id,
          notebookId,
          title: normalized.title,
          content: normalized.content,
          origin: normalized.origin,
          conversionNotes: normalized.conversionNotes,
          category: normalized.category,
          tags,
          createdAt: timestamp,
        });
        this.db
          .prepare(
            'INSERT INTO sources (id, notebook_id, title, slug, file_path, origin_json, conversion_notes_json, category, tags_json, word_count, content_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            id,
            notebookId,
            normalized.title,
            stored.slug,
            stored.filePath,
            JSON.stringify(normalized.origin),
            JSON.stringify(normalized.conversionNotes),
            normalized.category,
            JSON.stringify(tags),
            stored.wordCount,
            stored.contentHash,
            stored.createdAt,
            stored.updatedAt,
          );
        this.db
          .prepare('UPDATE notebooks SET updated_at = ? WHERE id = ?')
          .run(timestamp, notebookId);
        this.searchIndex.index({
          sourceId: id,
          notebookId,
          title: normalized.title,
          content: normalized.content,
        });
        return mapSource(this.getRow(id));
      })();
    } catch (error) {
      if (stored !== undefined) this.sourceFiles.remove(stored.filePath);
      throw error;
    }
  }

  createMany(notebookId: string, inputs: CreateSource[]): SourceMetadata[] {
    const created: SourceMetadata[] = [];
    const createAll = this.db.transaction(() => {
      for (const input of inputs) created.push(this.create(notebookId, input));
    });
    try {
      createAll();
      return created;
    } catch (error) {
      for (const source of created) this.sourceFiles.remove(source.filePath);
      throw error;
    }
  }

  /**
   * Refreshes the index row and FTS entry from the file when they drifted
   * (an out-of-band edit): frontmatter wins, but hand-edited tags are still
   * normalized so the index keeps the service's stable-casing guarantee (the
   * file itself is never rewritten). Returns whether anything drifted.
   */
  private reconcileFromFile(row: SourceRow, file: ReadSourceFile): boolean {
    const fileTags = normalizeTags(file.tags);
    if (
      file.title === row.title &&
      file.wordCount === row.word_count &&
      file.contentHash === row.content_hash &&
      file.updatedAt === row.updated_at &&
      file.category === row.category &&
      JSON.stringify(fileTags) === row.tags_json
    ) {
      return false;
    }
    this.db
      .prepare(
        'UPDATE sources SET title = ?, word_count = ?, content_hash = ?, updated_at = ?, category = ?, tags_json = ? WHERE id = ?',
      )
      .run(
        file.title,
        file.wordCount,
        file.contentHash,
        file.updatedAt,
        file.category,
        JSON.stringify(fileTags),
        row.id,
      );
    this.searchIndex.index({
      sourceId: row.id,
      notebookId: row.notebook_id,
      title: file.title,
      content: file.content,
    });
    return true;
  }

  get(id: string): SourceDetail {
    const row = this.getRow(id);
    const file = this.sourceFiles.read(row.file_path);
    this.assertFileIdentity(row, file);
    this.reconcileFromFile(row, file);

    try {
      return sourceDetailSchema.parse({
        ...mapSource(this.getRow(id)),
        content: file.content,
      });
    } catch (error) {
      if (error instanceof InvalidStoredDataError) throw error;
      throw new InvalidStoredDataError(`Source ${id} has invalid stored content`, {
        cause: error,
      });
    }
  }

  /**
   * Edits a saved source's title, content, category, and/or tags. Source
   * identity (`id`, `createdAt`, `origin`, conversion notes) is preserved; the
   * Markdown file is the source of truth, so it is rewritten first (recomputing
   * slug, hash, and word count) and the index row is updated to match. A title
   * change moves the slugged file path, so the old file is removed only after
   * the index commits. Any failure rolls the file back so no orphan or
   * stale-path row is left behind.
   */
  patch(id: string, input: PatchSource): SourceDetail {
    const normalized = patchSourceSchema.parse(input);
    const current = this.get(id);
    const title = normalized.title ?? current.title;
    const content = normalized.content ?? current.content;
    // `category: null` clears the category, so undefined alone means "keep".
    const category = normalized.category === undefined ? current.category : normalized.category;
    const tags = normalized.tags === undefined ? current.tags : normalizeTags(normalized.tags);
    const timestamp = this.now();

    const stored = this.sourceFiles.write({
      id: current.id,
      notebookId: current.notebookId,
      title,
      content,
      origin: current.origin,
      conversionNotes: current.conversionNotes,
      category,
      tags,
      createdAt: current.createdAt,
      updatedAt: timestamp,
    });
    const pathChanged = stored.filePath !== current.filePath;

    try {
      this.db.transaction(() => {
        this.db
          .prepare(
            'UPDATE sources SET title = ?, slug = ?, file_path = ?, word_count = ?, content_hash = ?, updated_at = ?, category = ?, tags_json = ? WHERE id = ?',
          )
          .run(
            title,
            stored.slug,
            stored.filePath,
            stored.wordCount,
            stored.contentHash,
            stored.updatedAt,
            category,
            JSON.stringify(tags),
            id,
          );
        this.db
          .prepare('UPDATE notebooks SET updated_at = ? WHERE id = ?')
          .run(timestamp, current.notebookId);
        this.searchIndex.index({
          sourceId: id,
          notebookId: current.notebookId,
          title,
          content,
        });
      })();
    } catch (error) {
      // Restore the file so the on-disk state matches the unchanged index row.
      if (pathChanged) {
        this.sourceFiles.remove(stored.filePath);
      } else {
        this.sourceFiles.write({
          id: current.id,
          notebookId: current.notebookId,
          title: current.title,
          content: current.content,
          origin: current.origin,
          conversionNotes: current.conversionNotes,
          category: current.category,
          tags: current.tags,
          createdAt: current.createdAt,
          updatedAt: current.updatedAt,
        });
      }
      throw error;
    }

    if (pathChanged) this.sourceFiles.remove(current.filePath);
    return this.get(id);
  }

  private assertFileIdentity(row: SourceRow, file: ReadSourceFile): void {
    let rowOrigin: unknown;
    let rowConversionNotes: unknown;
    try {
      rowOrigin = JSON.parse(row.origin_json);
      rowConversionNotes = JSON.parse(row.conversion_notes_json);
    } catch (error) {
      throw new InvalidStoredDataError(`Source ${row.id} has invalid stored metadata`, {
        cause: error,
      });
    }
    if (
      file.id !== row.id ||
      file.notebookId !== row.notebook_id ||
      !isDeepStrictEqual(file.origin, rowOrigin) ||
      !isDeepStrictEqual(file.conversionNotes, rowConversionNotes) ||
      file.createdAt !== row.created_at
    ) {
      throw new InvalidStoredDataError(`Source file ${row.file_path} does not match its index row`);
    }
  }

  delete(id: string): void {
    const row = this.getRow(id);
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM sources WHERE id = ?').run(id);
      this.searchIndex.remove(id);
      this.sourceFiles.remove(row.file_path);
    })();
  }
}
