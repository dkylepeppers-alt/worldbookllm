import type Database from 'better-sqlite3';

/**
 * Story-skills books (ADR 0014). Books are folders under data/projects/ and
 * their Markdown files are the source of truth; these tables are the
 * rebuildable index over them, keyed by (book slug, book-relative path).
 *
 * - `book_files` mirrors each Markdown file's classification, title, hash,
 *   and parsed frontmatter, reconciled against the disk on access.
 * - `book_search` is a standalone FTS5 table following ADR 0012.
 * - `book_checkpoints` / `book_checkpoint_files` record the before and after
 *   bytes of every file a change touched, so the change can be diffed and
 *   undone (ADR 0015 decision 5). Unlike the index, checkpoints cannot be
 *   rebuilt from disk; they are history.
 */
export function migrateToVersion8(db: Database.Database): void {
  db.exec(`
    CREATE TABLE book_files (
      book TEXT NOT NULL,
      path TEXT NOT NULL,
      kind TEXT NOT NULL,
      entity_id TEXT,
      title TEXT NOT NULL,
      hash TEXT NOT NULL,
      size INTEGER NOT NULL,
      mtime_ms REAL NOT NULL,
      frontmatter_json TEXT,
      PRIMARY KEY (book, path)
    );
    CREATE VIRTUAL TABLE book_search USING fts5(
      title,
      content,
      book UNINDEXED,
      path UNINDEXED,
      tokenize = 'unicode61 remove_diacritics 2'
    );
    CREATE TABLE book_checkpoints (
      id TEXT PRIMARY KEY,
      book TEXT NOT NULL,
      label TEXT NOT NULL,
      actor TEXT NOT NULL CHECK (actor IN ('user', 'agent')),
      created_at TEXT NOT NULL,
      undone_at TEXT
    );
    CREATE INDEX book_checkpoints_by_book ON book_checkpoints (book, created_at);
    CREATE TABLE book_checkpoint_files (
      checkpoint_id TEXT NOT NULL REFERENCES book_checkpoints (id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      before_content BLOB,
      after_content BLOB,
      before_hash TEXT,
      after_hash TEXT,
      PRIMARY KEY (checkpoint_id, path)
    );
  `);
}
