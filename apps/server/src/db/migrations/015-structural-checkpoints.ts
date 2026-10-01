import type Database from 'better-sqlite3';

/**
 * Structural checkpoints.
 *
 * Moving a book into or out of a series moves its folder as well as editing
 * `story.md`. Undo restores file contents only, so these checkpoints are
 * marked `structural` and undo refuses them rather than leave a book whose
 * frontmatter and folder disagree (ADR 0018).
 */
export function migrateToVersion15(db: Database.Database): void {
  db.exec(`ALTER TABLE book_checkpoints ADD COLUMN structural INTEGER NOT NULL DEFAULT 0;`);
}
