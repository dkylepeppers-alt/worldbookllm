import type Database from 'better-sqlite3';

export function migrateToVersion2(db: Database.Database): void {
  db.exec(`
    CREATE TABLE sources_v2 (
      id TEXT PRIMARY KEY,
      notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      slug TEXT NOT NULL,
      file_path TEXT NOT NULL UNIQUE,
      origin_json TEXT NOT NULL,
      conversion_notes_json TEXT NOT NULL DEFAULT '[]',
      word_count INTEGER NOT NULL CHECK (word_count >= 0),
      content_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    INSERT INTO sources_v2 (
      id, notebook_id, title, slug, file_path, origin_json, conversion_notes_json, word_count,
      content_hash, created_at, updated_at
    )
    SELECT
      id, notebook_id, title, slug, file_path, '{"type":"paste"}', '[]', word_count,
      content_hash, created_at, updated_at
    FROM sources;

    DROP TABLE sources;
    ALTER TABLE sources_v2 RENAME TO sources;
    CREATE INDEX sources_notebook_id_idx ON sources(notebook_id);
  `);
}
