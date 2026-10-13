import type Database from 'better-sqlite3';

/**
 * Discovery (ADR 0033).
 *
 * `discover_reads` records the chapters a reader has reached in Play, which
 * decides whether a stale beat is rewritten or listed for review. It is not
 * book content: losing it makes unedited beats look unread, and edits are
 * read from the files themselves. `discover_proposals` holds the variables
 * the beat writer asked for and the writer has not decided on yet.
 */
export function migrateToVersion16(db: Database.Database): void {
  db.exec(`
    CREATE TABLE discover_reads (
      book TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      read_at TEXT NOT NULL,
      PRIMARY KEY (book, chapter_id)
    );
    CREATE TABLE discover_proposals (
      id TEXT PRIMARY KEY,
      book TEXT NOT NULL,
      name TEXT NOT NULL,
      initial TEXT NOT NULL,
      meaning TEXT NOT NULL,
      reason TEXT NOT NULL,
      chapter_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX discover_proposals_by_book ON discover_proposals (book, created_at);
  `);
}
