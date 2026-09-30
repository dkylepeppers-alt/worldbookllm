import type Database from 'better-sqlite3';

/**
 * Custom agents and review mode (ADR 0015 decision 5, ADR 0016).
 *
 * - `custom_agents` are saved agents: standing instructions and the skills
 *   they may use. A chat names one, or none for the default agent.
 * - `agent_chats.review_mode` overrides the global `agent_review_mode`
 *   setting per chat (NULL follows the setting).
 * - A review-mode turn stores its proposed file changes as a changeset
 *   instead of applying them. `before_content` is the file as the turn
 *   found it; `reported` marks a resolved changeset whose outcome has been
 *   told to the model.
 * - `agent_messages.note` is what the app told the model alongside a user
 *   message (the review outcome), kept so later turns rebuild the same history.
 */
export function migrateToVersion12(db: Database.Database): void {
  db.exec(`
    CREATE TABLE custom_agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      instructions TEXT NOT NULL DEFAULT '',
      skills_json TEXT NOT NULL DEFAULT 'null',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    ALTER TABLE agent_chats
      ADD COLUMN agent_id TEXT REFERENCES custom_agents (id) ON DELETE SET NULL;
    ALTER TABLE agent_chats
      ADD COLUMN review_mode INTEGER CHECK (review_mode IN (0, 1));
    ALTER TABLE agent_messages ADD COLUMN note TEXT;
    ALTER TABLE app_settings
      ADD COLUMN agent_review_mode INTEGER NOT NULL DEFAULT 0 CHECK (agent_review_mode IN (0, 1));

    CREATE TABLE agent_changesets (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL REFERENCES agent_chats (id) ON DELETE CASCADE,
      message_id TEXT NOT NULL,
      book TEXT NOT NULL,
      created_at TEXT NOT NULL,
      reported INTEGER NOT NULL DEFAULT 0 CHECK (reported IN (0, 1))
    );
    CREATE INDEX agent_changesets_by_chat ON agent_changesets (chat_id, created_at);
    CREATE TABLE agent_changeset_files (
      changeset_id TEXT NOT NULL REFERENCES agent_changesets (id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      before_content BLOB,
      after_content BLOB,
      status TEXT NOT NULL CHECK (status IN ('pending', 'applied', 'skipped')),
      PRIMARY KEY (changeset_id, path)
    );
  `);
}
