import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';

import { migrateToVersion1 } from './migrations/001-init.js';
import { migrateToVersion2 } from './migrations/002-source-provenance.js';
import { migrateToVersion3 } from './migrations/003-presets.js';

interface Migration {
  version: number;
  up(db: Database.Database): void;
}

const MIGRATIONS: readonly Migration[] = [
  { version: 1, up: migrateToVersion1 },
  { version: 2, up: migrateToVersion2 },
  { version: 3, up: migrateToVersion3 },
];
const LATEST_SCHEMA_VERSION = MIGRATIONS.at(-1)?.version ?? 0;

function readUserVersion(db: Database.Database): number {
  return db.pragma('user_version', { simple: true }) as number;
}

function runMigrations(db: Database.Database): void {
  const currentVersion = readUserVersion(db);
  if (currentVersion > LATEST_SCHEMA_VERSION) {
    throw new Error(
      `Database uses newer schema version ${currentVersion}; this application supports ${LATEST_SCHEMA_VERSION}`,
    );
  }

  for (const migration of MIGRATIONS) {
    if (migration.version <= currentVersion) continue;

    db.transaction(() => {
      migration.up(db);
      db.pragma(`user_version = ${migration.version}`);
    })();
  }
}

export function openDatabase(dataDir: string): Database.Database {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, 'worldbookllm.db'));

  try {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
