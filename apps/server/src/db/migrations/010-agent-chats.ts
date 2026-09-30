import type Database from 'better-sqlite3';

/**
 * Agent chats on story-skills books (ADR 0015). They live beside the
 * notebook `chats` table, whose rows are bound to notebooks, until the
 * notebook UI is retired.
 *
 * An assistant message records its turn in `steps_json` (every model
 * request's secret-free body, the tool calls made, and each tool result) and
 * points at the checkpoint holding the turn's file changes, so the turn can
 * be inspected and undone.
 */
export function migrateToVersion10(db: Database.Database): void {
  db.exec(`
    CREATE TABLE agent_chats (
      id TEXT PRIMARY KEY,
      book TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX agent_chats_by_book ON agent_chats (book, updated_at);
    CREATE TABLE agent_messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL REFERENCES agent_chats (id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      reasoning TEXT,
      status TEXT NOT NULL CHECK (status IN ('complete', 'streaming', 'interrupted', 'error')),
      steps_json TEXT NOT NULL DEFAULT '[]',
      checkpoint_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (chat_id, seq)
    );
  `);
}
