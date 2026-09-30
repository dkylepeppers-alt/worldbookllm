import type Database from 'better-sqlite3';

/**
 * Retiring the notebook era (ADR 0017).
 *
 * - `app_settings.agent_generation_json` replaces presets for the agent. It
 *   is seeded from the default preset's generation controls (temperature,
 *   top-p, max tokens, thinking); prompt modules and the assistant prefill
 *   are dropped.
 * - `app_settings.notebook_migration_seen` records that the writer has seen
 *   the one-time report of notebooks moved into books.
 * - `notebook_migrations.chat_count` counts the notebook chats carried over
 *   as agent chats.
 *
 * The notebook-era tables stay, unused, so the move can be audited and no
 * history is dropped.
 */
export function migrateToVersion13(db: Database.Database): void {
  db.exec(`
    ALTER TABLE app_settings ADD COLUMN agent_generation_json TEXT NOT NULL
      DEFAULT '{"temperature":1,"topP":null,"maxTokens":null,"thinking":false}';
    ALTER TABLE app_settings ADD COLUMN notebook_migration_seen INTEGER NOT NULL DEFAULT 0
      CHECK (notebook_migration_seen IN (0, 1));
    ALTER TABLE notebook_migrations ADD COLUMN chat_count INTEGER NOT NULL DEFAULT 0;

    UPDATE app_settings
    SET agent_generation_json = (
      SELECT json_object(
        'temperature', json_extract(presets.definition_json, '$.generation.temperature'),
        'topP', json_extract(presets.definition_json, '$.generation.topP'),
        'maxTokens', json_extract(presets.definition_json, '$.generation.maxTokens'),
        'thinking', CASE json_extract(presets.definition_json, '$.generation.thinking')
          WHEN 1 THEN json('true') ELSE json('false') END
      )
      FROM presets
      WHERE presets.id = app_settings.default_preset_id
    )
    WHERE EXISTS (SELECT 1 FROM presets WHERE presets.id = app_settings.default_preset_id);
  `);
}
