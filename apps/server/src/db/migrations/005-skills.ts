import type Database from 'better-sqlite3';

/**
 * Adds the creative skills library (ADR 0011). Skills are SKILL.md folders on
 * disk under data/skills/; this table is the rebuildable index over them, and
 * chats gain a per-chat skill selection parallel to source_ids_json.
 *
 * `skill_ids_json` defaults to an empty array so pre-existing chats need no
 * backfill.
 */
export function migrateToVersion5(db: Database.Database): void {
  db.exec(`
    CREATE TABLE skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      description TEXT NOT NULL,
      dir_path TEXT NOT NULL,
      origin_json TEXT NOT NULL,
      license TEXT,
      word_count INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    ALTER TABLE chats ADD COLUMN skill_ids_json TEXT NOT NULL DEFAULT '[]';
  `);
}
