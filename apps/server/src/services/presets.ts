import { randomUUID } from 'node:crypto';

import {
  appSettingsSchema,
  createPresetSchema,
  patchPresetSchema,
  portablePresetSchema,
  type AppSettings,
  type CreatePreset,
  type PatchPreset,
  type PortablePreset,
  type Preset,
  presetSchema,
} from '@worldbookllm/shared';
import type Database from 'better-sqlite3';

import type { AppSettingsRow, PresetRow } from '../db/types.js';
import { ConflictError, InvalidStoredDataError, NotFoundError } from '../errors.js';

function mapPreset(row: PresetRow): Preset {
  try {
    const definition = portablePresetSchema.parse(JSON.parse(row.definition_json));
    if (definition.name !== row.name) {
      throw new Error('Preset name does not match its stored definition');
    }
    return presetSchema.parse({
      id: row.id,
      ...definition,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  } catch (error) {
    throw new InvalidStoredDataError(`Preset ${row.id} has invalid stored data`, { cause: error });
  }
}

function isUniqueConstraint(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY')
  );
}

export class PresetService {
  constructor(
    private readonly db: Database.Database,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  list(): Preset[] {
    return (
      this.db.prepare('SELECT * FROM presets ORDER BY name COLLATE NOCASE, id').all() as PresetRow[]
    ).map(mapPreset);
  }

  get(id: string): Preset {
    const row = this.db.prepare('SELECT * FROM presets WHERE id = ?').get(id) as
      PresetRow | undefined;
    if (!row) throw new NotFoundError(`Preset ${id} was not found`);
    return mapPreset(row);
  }

  private firstAvailableName(baseName: string): string {
    let candidate = baseName;
    let suffix = 2;
    const exists = this.db.prepare('SELECT 1 FROM presets WHERE name = ? COLLATE NOCASE');
    while (exists.get(candidate)) {
      candidate = `${baseName} (${suffix})`;
      suffix += 1;
    }
    return candidate;
  }

  create(input: CreatePreset): Preset {
    const parsed = createPresetSchema.parse(input);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        return this.db.transaction(() => {
          const name = this.firstAvailableName(parsed.name);
          const definition: PortablePreset = { ...parsed, name };
          const id = randomUUID();
          const timestamp = this.now();
          this.db
            .prepare(
              'INSERT INTO presets (id, name, definition_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
            )
            .run(id, name, JSON.stringify(definition), timestamp, timestamp);
          return this.get(id);
        })();
      } catch (error) {
        if (!isUniqueConstraint(error)) throw error;
      }
    }
    throw new ConflictError('preset_name_conflict', `Could not allocate a unique preset name`);
  }

  patch(id: string, input: PatchPreset): Preset {
    const patch = patchPresetSchema.parse(input);
    try {
      return this.db.transaction(() => {
        const current = this.get(id);
        const definition = portablePresetSchema.parse({
          schemaVersion: current.schemaVersion,
          name: patch.name ?? current.name,
          generation: patch.generation ?? current.generation,
          modules: patch.modules ?? current.modules,
        });
        this.db
          .prepare('UPDATE presets SET name = ?, definition_json = ?, updated_at = ? WHERE id = ?')
          .run(definition.name, JSON.stringify(definition), this.now(), id);
        return this.get(id);
      })();
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new ConflictError(
          'preset_name_conflict',
          `A preset named ${patch.name ?? ''} already exists`,
        );
      }
      throw error;
    }
  }

  delete(id: string): void {
    this.db.transaction(() => {
      this.get(id);
      if (this.getSettings().defaultPresetId === id) {
        throw new ConflictError('default_preset', 'The default preset cannot be deleted');
      }
      this.db.prepare('DELETE FROM presets WHERE id = ?').run(id);
    })();
  }

  getSettings(): AppSettings {
    const row = this.db.prepare('SELECT * FROM app_settings WHERE id = 1').get() as
      AppSettingsRow | undefined;
    try {
      return appSettingsSchema.parse({ defaultPresetId: row?.default_preset_id });
    } catch (error) {
      throw new InvalidStoredDataError('Application settings have invalid stored data', {
        cause: error,
      });
    }
  }

  setDefault(presetId: string): AppSettings {
    return this.db.transaction(() => {
      this.get(presetId);
      this.db.prepare('UPDATE app_settings SET default_preset_id = ? WHERE id = 1').run(presetId);
      return this.getSettings();
    })();
  }

  resolve(presetId: string | null): Preset {
    return this.get(presetId ?? this.getSettings().defaultPresetId);
  }
}
