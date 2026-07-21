import type Database from 'better-sqlite3';

/**
 * Collapses per-notebook default and per-chat override provider config into
 * one global setting on the app_settings singleton. The old resolution was
 * `chat.providerOverride ?? notebook.settings`, so a chat could be the only
 * place a provider was configured (override set, notebook default left
 * null) — the seed must consider both columns, not just notebooks, before
 * either is dropped. Seeds from whichever configured value (on either table)
 * was most recently updated, so a single-provider workspace keeps working
 * without reconfiguration; a workspace with several different providers
 * across notebooks and/or chats keeps only one and the rest must be
 * reconfigured once in Settings.
 */
export function migrateToVersion7(db: Database.Database): void {
  db.exec(`
    ALTER TABLE app_settings ADD COLUMN provider_config_json TEXT NOT NULL DEFAULT 'null';

    UPDATE app_settings
    SET provider_config_json = (
      SELECT value FROM (
        SELECT settings_json AS value, updated_at FROM notebooks WHERE settings_json != 'null'
        UNION ALL
        SELECT provider_override_json AS value, updated_at FROM chats
        WHERE provider_override_json != 'null'
      )
      ORDER BY updated_at DESC
      LIMIT 1
    )
    WHERE EXISTS (
      SELECT 1 FROM notebooks WHERE settings_json != 'null'
      UNION ALL
      SELECT 1 FROM chats WHERE provider_override_json != 'null'
    );

    ALTER TABLE notebooks DROP COLUMN settings_json;
    ALTER TABLE chats DROP COLUMN provider_override_json;
  `);
}
