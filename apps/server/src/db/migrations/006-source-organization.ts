import type Database from 'better-sqlite3';

/**
 * Knowledge-base organization (M3): sources gain an optional category and
 * free-form tags, and the notebook gains full-text search.
 *
 * `category` stays NULL for existing sources (uncategorized is a legitimate
 * state, distinct from `misc`) and `tags_json` defaults to an empty array, so
 * no backfill is needed.
 *
 * `source_search` is a standalone FTS5 table (ADR 0012): source content lives
 * in Markdown files, not in a SQLite column, so external-content FTS is not an
 * option, and services keep the index in sync explicitly inside their write
 * transactions. It is created empty here; startup reconciliation
 * (`SourceService.ensureSearchIndex`) backfills it from the files on disk.
 */
export function migrateToVersion6(db: Database.Database): void {
  db.exec(`
    ALTER TABLE sources ADD COLUMN category TEXT;
    ALTER TABLE sources ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
    CREATE VIRTUAL TABLE source_search USING fts5(
      title,
      content,
      source_id UNINDEXED,
      notebook_id UNINDEXED,
      tokenize = 'unicode61 remove_diacritics 2'
    );
  `);
}
