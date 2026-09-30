import type Database from 'better-sqlite3';

/**
 * Tracks the one-time move of notebooks into story-skills books (ADR 0014
 * decision 6): one row per notebook, so the migration is idempotent and its
 * outcome can be reported to the user.
 */
export function migrateToVersion9(db: Database.Database): void {
  db.exec(`
    CREATE TABLE notebook_migrations (
      notebook_id TEXT PRIMARY KEY,
      book_slug TEXT NOT NULL,
      migrated_at TEXT NOT NULL,
      source_count INTEGER NOT NULL,
      file_count INTEGER NOT NULL,
      error TEXT
    );
  `);
}
