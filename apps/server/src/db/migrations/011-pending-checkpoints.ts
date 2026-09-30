import type Database from 'better-sqlite3';

/**
 * Agent turns can span several separately locked writes. A pending checkpoint
 * reserves their place in history as soon as the first write completes, so a
 * user checkpoint that lands during the turn remains ordered after it.
 */
export function migrateToVersion11(db: Database.Database): void {
  db.exec(`
    ALTER TABLE book_checkpoints
      ADD COLUMN pending INTEGER NOT NULL DEFAULT 0 CHECK (pending IN (0, 1));
  `);
}
