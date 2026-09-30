import {
  DEFAULT_AGENT_GENERATION,
  appSettingsSchema,
  type AppSettings,
  type PatchAppSettings,
} from '@worldbookllm/shared';
import type Database from 'better-sqlite3';

import type { AppSettingsRow } from '../db/types.js';
import { InvalidStoredDataError } from '../errors.js';

/**
 * The app-wide settings singleton: the provider and model (ADR 0013), the
 * agent's review-mode default (ADR 0016), and its generation controls
 * (ADR 0017).
 */
export class SettingsService {
  constructor(private readonly db: Database.Database) {}

  private row(): AppSettingsRow | undefined {
    return this.db.prepare('SELECT * FROM app_settings WHERE id = 1').get() as
      AppSettingsRow | undefined;
  }

  getSettings(): AppSettings {
    const row = this.row();
    try {
      return appSettingsSchema.parse({
        providerConfig: row === undefined ? null : JSON.parse(row.provider_config_json),
        agentReviewMode: row?.agent_review_mode === 1,
        agentGeneration:
          row === undefined ? DEFAULT_AGENT_GENERATION : JSON.parse(row.agent_generation_json),
      });
    } catch (error) {
      throw new InvalidStoredDataError('Application settings have invalid stored data', {
        cause: error,
      });
    }
  }

  updateSettings(input: PatchAppSettings): AppSettings {
    return this.db.transaction(() => {
      const current = this.getSettings();
      this.db
        .prepare(
          'UPDATE app_settings SET provider_config_json = ?, agent_review_mode = ?, agent_generation_json = ? WHERE id = 1',
        )
        .run(
          JSON.stringify(
            input.providerConfig === undefined ? current.providerConfig : input.providerConfig,
          ),
          (input.agentReviewMode ?? current.agentReviewMode) ? 1 : 0,
          JSON.stringify(input.agentGeneration ?? current.agentGeneration),
        );
      return this.getSettings();
    })();
  }

  /** Whether the writer has dismissed the report of notebooks moved into books. */
  notebookMigrationSeen(): boolean {
    return this.row()?.notebook_migration_seen === 1;
  }

  markNotebookMigrationSeen(): void {
    this.db.prepare('UPDATE app_settings SET notebook_migration_seen = 1 WHERE id = 1').run();
  }
}
