import type Database from 'better-sqlite3';

/**
 * Collapses per-notebook default and per-chat override provider config into
 * one global setting on the app_settings singleton. Seeds it from whichever
 * notebook was most recently updated with a configured provider, so a
 * single-provider workspace keeps working without reconfiguration; a
 * workspace with several different per-notebook providers keeps only one and
 * the rest must be reconfigured once in Settings.
 */
export function migrateToVersion7(db: Database.Database): void {
  db.exec(`
    ALTER TABLE app_settings ADD COLUMN provider_config_json TEXT NOT NULL DEFAULT 'null';

    UPDATE app_settings
    SET provider_config_json = (
      SELECT settings_json FROM notebooks
      WHERE settings_json != 'null'
      ORDER BY updated_at DESC, id ASC
      LIMIT 1
    )
    WHERE EXISTS (SELECT 1 FROM notebooks WHERE settings_json != 'null');

    ALTER TABLE notebooks DROP COLUMN settings_json;
    ALTER TABLE chats DROP COLUMN provider_override_json;
  `);
}
