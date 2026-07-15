import { randomUUID } from 'node:crypto';

import type { PortablePreset } from '@worldbookllm/shared';
import type Database from 'better-sqlite3';

const GROUNDED_DEVELOPMENT: PortablePreset = {
  schemaVersion: 1,
  name: 'Grounded development',
  generation: {
    temperature: 0.7,
    topP: null,
    maxTokens: null,
    assistantPrefill: null,
  },
  modules: [
    {
      key: 'assistant-role',
      name: 'Assistant role',
      kind: 'custom',
      role: 'system',
      content:
        'You are a creative writing and worldbuilding assistant working from user-provided source material.',
      enabled: true,
      insertion: { position: 'before_history' },
    },
    {
      key: 'sources',
      name: 'Selected sources',
      kind: 'sources',
      role: 'system',
      content: null,
      enabled: true,
      insertion: { position: 'before_history' },
    },
    {
      key: 'grounding-instructions',
      name: 'Grounding instructions',
      kind: 'custom',
      role: 'system',
      content:
        'Treat the supplied sources as the grounding for your answer. Preserve established facts and clearly distinguish reasonable development from facts stated in the sources. If the sources do not answer something, say so rather than inventing certainty.',
      enabled: true,
      insertion: { position: 'before_history' },
    },
  ],
};

export function migrateToVersion3(db: Database.Database): void {
  db.exec(`
    CREATE TABLE presets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      definition_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE app_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      default_preset_id TEXT NOT NULL REFERENCES presets(id) ON DELETE RESTRICT
    );

    ALTER TABLE chats
      ADD COLUMN preset_id TEXT REFERENCES presets(id) ON DELETE SET NULL;
  `);

  const presetId = randomUUID();
  const timestamp = new Date().toISOString();
  db.prepare(
    'INSERT INTO presets (id, name, definition_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run(
    presetId,
    GROUNDED_DEVELOPMENT.name,
    JSON.stringify(GROUNDED_DEVELOPMENT),
    timestamp,
    timestamp,
  );
  db.prepare('INSERT INTO app_settings (id, default_preset_id) VALUES (1, ?)').run(presetId);
}
