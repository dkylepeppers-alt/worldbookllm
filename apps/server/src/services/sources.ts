import { randomUUID } from 'node:crypto';

import {
  type CreateSource,
  type SourceDetail,
  type SourceMetadata,
  sourceDetailSchema,
  sourceMetadataSchema,
  sourceOriginSchema,
  conversionNotesSchema,
} from '@worldbookllm/shared';
import type Database from 'better-sqlite3';

import type { SourceRow } from '../db/types.js';
import { InvalidStoredDataError, NotFoundError } from '../errors.js';
import { type ReadSourceFile, SourceFileStore } from '../files/source-files.js';

function mapSource(row: SourceRow): SourceMetadata {
  try {
    const origin = sourceOriginSchema.parse(JSON.parse(row.origin_json));
    const conversionNotes = conversionNotesSchema.parse(JSON.parse(row.conversion_notes_json));
    return sourceMetadataSchema.parse({
      id: row.id,
      notebookId: row.notebook_id,
      title: row.title,
      slug: row.slug,
      filePath: row.file_path,
      origin,
      conversionNotes,
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
  constructor(
    private readonly db: Database.Database,
    private readonly sourceFiles: SourceFileStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

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

  list(notebookId: string): SourceMetadata[] {
    this.requireNotebook(notebookId);
    const rows = this.db
      .prepare('SELECT * FROM sources WHERE notebook_id = ? ORDER BY created_at ASC, id ASC')
      .all(notebookId) as SourceRow[];
    return rows.map(mapSource);
  }

  create(notebookId: string, input: CreateSource): SourceMetadata {
    this.requireNotebook(notebookId);
    const id = randomUUID();
    const timestamp = this.now();
    const stored = this.sourceFiles.write({
      id,
      notebookId,
      title: input.title,
      content: input.content,
      origin: input.origin,
      conversionNotes: input.conversionNotes,
      createdAt: timestamp,
    });

    try {
      this.db.transaction(() => {
        this.db
          .prepare(
            'INSERT INTO sources (id, notebook_id, title, slug, file_path, origin_json, conversion_notes_json, word_count, content_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            id,
            notebookId,
            input.title,
            stored.slug,
            stored.filePath,
            JSON.stringify(input.origin),
            JSON.stringify(input.conversionNotes),
            stored.wordCount,
            stored.contentHash,
            stored.createdAt,
            stored.updatedAt,
          );
        this.db
          .prepare('UPDATE notebooks SET updated_at = ? WHERE id = ?')
          .run(timestamp, notebookId);
      })();
    } catch (error) {
      this.sourceFiles.remove(stored.filePath);
      throw error;
    }

    createMany(notebookId: string, inputs: CreateSource[]): SourceMetadata[] {
      const created: SourceMetadata[] = [];
      try {
        for (const input of inputs) created.push(this.create(notebookId, input));
        return created;
      } catch (error) {
        for (const source of created.reverse()) this.delete(source.id);
        throw error;
      }
    }

    return mapSource(this.getRow(id));
  }

  get(id: string): SourceDetail {
    const row = this.getRow(id);
    const file = this.sourceFiles.read(row.file_path);
    this.assertFileIdentity(row, file);

    if (
      file.title !== row.title ||
      file.wordCount !== row.word_count ||
      file.contentHash !== row.content_hash ||
      file.updatedAt !== row.updated_at
    ) {
      this.db
        .prepare(
          'UPDATE sources SET title = ?, word_count = ?, content_hash = ?, updated_at = ? WHERE id = ?',
        )
        .run(file.title, file.wordCount, file.contentHash, file.updatedAt, id);
    }

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

  private assertFileIdentity(row: SourceRow, file: ReadSourceFile): void {
    if (
      file.id !== row.id ||
      file.notebookId !== row.notebook_id ||
      JSON.stringify(file.origin) !== row.origin_json ||
      JSON.stringify(file.conversionNotes) !== row.conversion_notes_json ||
      file.createdAt !== row.created_at
    ) {
      throw new InvalidStoredDataError(`Source file ${row.file_path} does not match its index row`);
    }
  }

  delete(id: string): void {
    const row = this.getRow(id);
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM sources WHERE id = ?').run(id);
      this.sourceFiles.remove(row.file_path);
    })();
  }
}
