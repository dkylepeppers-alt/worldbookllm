import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';

import { migrateToVersion1 } from './migrations/001-init.js';
import { migrateToVersion2 } from './migrations/002-source-provenance.js';
import { migrateToVersion3 } from './migrations/003-presets.js';
import { migrateToVersion4 } from './migrations/004-message-variants.js';
import { migrateToVersion5 } from './migrations/005-skills.js';
import { migrateToVersion6 } from './migrations/006-source-organization.js';
import { migrateToVersion7 } from './migrations/007-global-provider-settings.js';
import { migrateToVersion8 } from './migrations/008-books.js';
import { migrateToVersion9 } from './migrations/009-notebook-migrations.js';
import { migrateToVersion10 } from './migrations/010-agent-chats.js';
import { migrateToVersion11 } from './migrations/011-pending-checkpoints.js';

interface Migration {
  version: number;
  up(db: Database.Database): void;
}

const MIGRATIONS: readonly Migration[] = [
  { version: 1, up: migrateToVersion1 },
  { version: 2, up: migrateToVersion2 },
  { version: 3, up: migrateToVersion3 },
  { version: 4, up: migrateToVersion4 },
  { version: 5, up: migrateToVersion5 },
  { version: 6, up: migrateToVersion6 },
  { version: 7, up: migrateToVersion7 },
  { version: 8, up: migrateToVersion8 },
  { version: 9, up: migrateToVersion9 },
  { version: 10, up: migrateToVersion10 },
  { version: 11, up: migrateToVersion11 },
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
