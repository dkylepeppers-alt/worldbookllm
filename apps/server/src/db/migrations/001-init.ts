import type Database from 'better-sqlite3';

export function migrateToVersion1(db: Database.Database): void {
  db.exec(`
    CREATE TABLE notebooks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      settings_json TEXT NOT NULL DEFAULT 'null',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE sources (
      id TEXT PRIMARY KEY,
      notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      slug TEXT NOT NULL,
      file_path TEXT NOT NULL UNIQUE,
      origin TEXT NOT NULL CHECK (origin IN ('paste')),
      word_count INTEGER NOT NULL CHECK (word_count >= 0),
      content_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX sources_notebook_id_idx ON sources(notebook_id);

    CREATE TABLE chats (
      id TEXT PRIMARY KEY,
      notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      source_ids_json TEXT NOT NULL DEFAULT '[]',
      provider_override_json TEXT NOT NULL DEFAULT 'null',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX chats_notebook_id_idx ON chats(notebook_id);

    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL CHECK (seq >= 0),
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      reasoning TEXT,
      status TEXT NOT NULL CHECK (status IN ('complete', 'interrupted', 'error')),
      context_json TEXT NOT NULL DEFAULT 'null',
      created_at TEXT NOT NULL,
      UNIQUE (chat_id, seq)
    );

    CREATE INDEX messages_chat_id_idx ON messages(chat_id);
  `);
}
