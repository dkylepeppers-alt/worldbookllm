import type Database from 'better-sqlite3';

import { quoted, provenanceLines } from '../story/book-import.js';
import type { BookService, ImportEntry } from './books.js';
import type { NotebookService } from './notebooks.js';
import type { SourceService } from './sources.js';

export interface NotebookMigrationOutcome {
  notebookId: string;
  notebookName: string;
  bookSlug: string;
  sourceCount: number;
  fileCount: number;
  /** Why the sources could not be written; the book then exists without them. */
  error: string | null;
  /** Sources whose files could not be read and were left out. */
  skippedSources: Array<{ sourceId: string; title: string; reason: string }>;
}

interface MigrationRow {
  notebook_id: string;
  book_slug: string;
}

/**
 * The one-time move from notebooks to story-skills books (ADR 0014 decision
 * 6). Each notebook becomes a book created with `story init`, and each of
 * its sources becomes a research note carrying its original provenance, its
 * import time, and its category and tags as the flat keys `legacy-category`
 * and `tags`. Nothing under data/notebooks/ is modified or deleted.
 *
 * The migration is idempotent: a notebook that already has a row in
 * `notebook_migrations` is skipped. A notebook whose notes fail validation
 * is rolled back by the import path and reported with its error, without
 * stopping the others.
 *
 * Not run at startup yet: the notebook UI stays live until the web app moves
 * to books (M7 phase 2), which also rebinds chats and retires the notebook
 * folder.
 */
export class NotebookMigrationService {
  constructor(
    private readonly db: Database.Database,
    private readonly notebooks: NotebookService,
    private readonly sources: SourceService,
    private readonly books: BookService,
  ) {}

  /** Book slugs already created from notebooks, by notebook id. */
  migrated(): Map<string, string> {
    const rows = this.db
      .prepare('SELECT notebook_id, book_slug FROM notebook_migrations')
      .all() as MigrationRow[];
    return new Map(rows.map((row) => [row.notebook_id, row.book_slug]));
  }

  async migrateAll(): Promise<NotebookMigrationOutcome[]> {
    const done = this.migrated();
    const outcomes: NotebookMigrationOutcome[] = [];
    for (const notebook of this.notebooks.list()) {
      if (done.has(notebook.id)) continue;
      outcomes.push(await this.migrateNotebook(notebook.id, notebook.name));
    }
    return outcomes;
  }

  private async migrateNotebook(
    notebookId: string,
    notebookName: string,
  ): Promise<NotebookMigrationOutcome> {
    const book = await this.books.create({ title: notebookName });
    const entries: ImportEntry[] = [];
    const skippedSources: NotebookMigrationOutcome['skippedSources'] = [];
    const metadata = this.sources.list(notebookId);

    for (const source of metadata) {
      try {
        const detail = this.sources.get(source.id);
        const provenance = provenanceLines(detail.origin, detail.conversionNotes, detail.createdAt);
        if (detail.category) provenance.push(`legacy-category: ${quoted(detail.category)}`);
        if (detail.tags.length > 0) {
          provenance.push('tags:', ...detail.tags.map((tag) => `  - ${quoted(tag)}`));
        }
        entries.push({
          title: detail.title,
          markdown: detail.content,
          kind: 'research',
          provenance,
        });
      } catch (error) {
        skippedSources.push({
          sourceId: source.id,
          title: source.title,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    let fileCount = 0;
    let failure: string | null = null;
    if (entries.length > 0) {
      try {
        const result = await this.books.writeImports(
          book.slug,
          `Migrate notebook ${notebookName}`,
          entries,
        );
        fileCount = result.files.length;
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
      }
    }

    this.db
      .prepare(
        `INSERT INTO notebook_migrations
           (notebook_id, book_slug, migrated_at, source_count, file_count, error)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(notebookId, book.slug, new Date().toISOString(), metadata.length, fileCount, failure);

    return {
      notebookId,
      notebookName,
      bookSlug: book.slug,
      sourceCount: metadata.length,
      fileCount,
      error: failure,
      skippedSources,
    };
  }
}
