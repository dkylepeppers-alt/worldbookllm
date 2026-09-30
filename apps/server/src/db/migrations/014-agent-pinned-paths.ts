import type Database from 'better-sqlite3';

/**
 * Pinned files on agent messages.
 *
 * `agent_messages.pinned_paths_json` lists the book files a user message
 * pinned. Their contents at send time are part of the message's `note`, so
 * later turns rebuild the same history; the paths are kept so the chat can
 * show the writer which files went to the model.
 */
export function migrateToVersion14(db: Database.Database): void {
  db.exec(`ALTER TABLE agent_messages ADD COLUMN pinned_paths_json TEXT NOT NULL DEFAULT '[]';`);
}
