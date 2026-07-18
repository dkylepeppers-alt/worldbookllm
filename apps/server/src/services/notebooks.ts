import { randomUUID } from 'node:crypto';

import {
  type CreateNotebook,
  type Notebook,
  notebookSchema,
  type PatchNotebook,
} from '@worldbookllm/shared';
import type Database from 'better-sqlite3';

import type { NotebookRow } from '../db/types.js';
import { InvalidStoredDataError, NotFoundError } from '../errors.js';
import type { SourceFileStore } from '../files/source-files.js';
import { SourceSearchIndex } from './source-search.js';

function mapNotebook(row: NotebookRow): Notebook {
  try {
    return notebookSchema.parse({
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  } catch (error) {
    throw new InvalidStoredDataError(`Notebook ${row.id} has invalid stored data`, {
      cause: error,
    });
  }
}

export class NotebookService {
  private readonly searchIndex: SourceSearchIndex;

  constructor(
    private readonly db: Database.Database,
    private readonly sourceFiles: SourceFileStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.searchIndex = new SourceSearchIndex(db);
  }

  list(): Notebook[] {
    const rows = this.db
      .prepare('SELECT * FROM notebooks ORDER BY updated_at DESC, id ASC')
      .all() as NotebookRow[];
    return rows.map(mapNotebook);
  }

  get(id: string): Notebook {
    const row = this.db.prepare('SELECT * FROM notebooks WHERE id = ?').get(id) as
      NotebookRow | undefined;
    if (!row) throw new NotFoundError(`Notebook ${id} was not found`);
    return mapNotebook(row);
  }

  create(input: CreateNotebook): Notebook {
    const id = randomUUID();
    const timestamp = this.now();
    this.db
      .prepare('INSERT INTO notebooks (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(id, input.name, timestamp, timestamp);
    return this.get(id);
  }

  patch(id: string, input: PatchNotebook): Notebook {
    this.get(id);
    this.db
      .prepare('UPDATE notebooks SET name = ?, updated_at = ? WHERE id = ?')
      .run(input.name, this.now(), id);
    return this.get(id);
  }

  delete(id: string): void {
    this.db.transaction(() => {
      const result = this.db.prepare('DELETE FROM notebooks WHERE id = ?').run(id);
      if (result.changes === 0) throw new NotFoundError(`Notebook ${id} was not found`);
      // Source rows cascade via FK, but the FTS index has no FK to cascade.
      this.searchIndex.removeNotebook(id);
      this.sourceFiles.removeNotebook(id);
    })();
  }
}
