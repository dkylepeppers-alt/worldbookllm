import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase } from './database.js';
import { migrateToVersion1 } from './migrations/001-init.js';
import { resolveDataDir } from '../env.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const directory = mkdtempSync(join(tmpdir(), 'worldbookllm-db-'));
  tempDirs.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('database startup', () => {
  it('resolves explicit data directories to absolute paths', () => {
    expect(resolveDataDir('./fixture-data')).toBe(resolve('./fixture-data'));
  });

  it('enables required pragmas and creates the latest schema', () => {
    const db = openDatabase(makeTempDir());

    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('user_version', { simple: true })).toBe(2);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .pluck()
      .all();
    expect(tables).toEqual(['chats', 'messages', 'notebooks', 'sources']);

    db.close();
  });

  it('applies migrations idempotently when reopened', () => {
    const dataDir = makeTempDir();
    openDatabase(dataDir).close();

    const reopened = openDatabase(dataDir);
    expect(reopened.pragma('user_version', { simple: true })).toBe(2);
    expect(reopened.prepare('SELECT count(*) FROM notebooks').pluck().get()).toBe(0);
    reopened.close();
  });

  it('migrates pasted source provenance from schema v1', () => {
    const dataDir = makeTempDir();
    const file = join(dataDir, 'worldbookllm.db');
    const legacy = new Database(file);
    migrateToVersion1(legacy);
    legacy.pragma('user_version = 1');
    const now = new Date().toISOString();
    legacy
      .prepare(
        'INSERT INTO notebooks (id, name, settings_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run('notebook', 'Atlas', 'null', now, now);
    legacy
      .prepare(
        'INSERT INTO sources (id, notebook_id, title, slug, file_path, origin, word_count, content_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        'source',
        'notebook',
        'Lore',
        'lore',
        'notebooks/notebook/sources/source-lore.md',
        'paste',
        1,
        'a'.repeat(64),
        now,
        now,
      );
    legacy.close();

    const migrated = openDatabase(dataDir);
    expect(migrated.pragma('user_version', { simple: true })).toBe(2);
    expect(
      migrated
        .prepare('SELECT origin_json, conversion_notes_json FROM sources WHERE id = ?')
        .get('source'),
    ).toEqual({
      origin_json: '{"type":"paste"}',
      conversion_notes_json: '[]',
    });
    migrated.close();
  });

  it('enforces cascade, role, status, and message sequence constraints', () => {
    const db = openDatabase(makeTempDir());
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO notebooks (id, name, settings_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('notebook', 'Atlas', 'null', now, now);
    db.prepare(
      'INSERT INTO sources (id, notebook_id, title, slug, file_path, origin_json, conversion_notes_json, word_count, content_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      'source',
      'notebook',
      'Lore',
      'lore',
      'notebooks/notebook/sources/source-lore.md',
      '{"type":"paste"}',
      '[]',
      1,
      'a'.repeat(64),
      now,
      now,
    );
    db.prepare(
      'INSERT INTO chats (id, notebook_id, title, source_ids_json, provider_override_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('chat', 'notebook', 'Chat', '[]', 'null', now, now);
    db.prepare(
      'INSERT INTO messages (id, chat_id, seq, role, content, reasoning, status, context_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('message', 'chat', 0, 'user', 'Hello', null, 'complete', 'null', now);

    expect(() =>
      db
        .prepare(
          'INSERT INTO messages (id, chat_id, seq, role, content, reasoning, status, context_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run('bad-role', 'chat', 1, 'system', 'No', null, 'complete', 'null', now),
    ).toThrow(/CHECK constraint failed/u);
    expect(() =>
      db
        .prepare(
          'INSERT INTO messages (id, chat_id, seq, role, content, reasoning, status, context_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run('duplicate-seq', 'chat', 0, 'assistant', 'No', null, 'complete', 'null', now),
    ).toThrow(/UNIQUE constraint failed/u);

    db.prepare('DELETE FROM notebooks WHERE id = ?').run('notebook');
    expect(db.prepare('SELECT count(*) FROM sources').pluck().get()).toBe(0);
    expect(db.prepare('SELECT count(*) FROM chats').pluck().get()).toBe(0);
    expect(db.prepare('SELECT count(*) FROM messages').pluck().get()).toBe(0);
    db.close();
  });

  it('rejects databases newer than this application without downgrading them', () => {
    const dataDir = makeTempDir();
    const file = join(dataDir, 'worldbookllm.db');
    const future = new Database(file);
    future.pragma('user_version = 3');
    future.close();

    expect(() => openDatabase(dataDir)).toThrow(/newer schema version 3/u);

    const unchanged = new Database(file);
    expect(unchanged.pragma('user_version', { simple: true })).toBe(3);
    unchanged.close();
  });
});
