import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase } from './database.js';
import { migrateToVersion1 } from './migrations/001-init.js';
import { migrateToVersion2 } from './migrations/002-source-provenance.js';
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
    expect(db.pragma('user_version', { simple: true })).toBe(3);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .pluck()
      .all();
    expect(tables).toEqual([
      'app_settings',
      'chats',
      'messages',
      'notebooks',
      'presets',
      'sources',
    ]);

    const presets = db.prepare('SELECT * FROM presets').all() as Array<{
      id: string;
      name: string;
      definition_json: string;
      created_at: string;
      updated_at: string;
    }>;
    expect(presets).toHaveLength(1);
    expect(presets[0]).toMatchObject({
      id: expect.any(String),
      name: 'Grounded development',
      created_at: expect.any(String),
      updated_at: expect.any(String),
    });
    expect(JSON.parse(presets[0]?.definition_json ?? '')).toEqual({
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
    });
    expect(db.prepare('SELECT id, default_preset_id FROM app_settings').get()).toEqual({
      id: 1,
      default_preset_id: presets[0]?.id,
    });

    const chatColumns = db.prepare('PRAGMA table_info(chats)').all() as Array<{
      name: string;
      notnull: number;
    }>;
    expect(chatColumns).toContainEqual(expect.objectContaining({ name: 'preset_id', notnull: 0 }));

    db.close();
  });

  it('applies migrations idempotently when reopened', () => {
    const dataDir = makeTempDir();
    openDatabase(dataDir).close();

    const reopened = openDatabase(dataDir);
    expect(reopened.pragma('user_version', { simple: true })).toBe(3);
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
    expect(migrated.pragma('user_version', { simple: true })).toBe(3);
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

  it('upgrades schema v2 without losing user data and leaves existing chats inheriting', () => {
    const dataDir = makeTempDir();
    const file = join(dataDir, 'worldbookllm.db');
    const legacy = new Database(file);
    migrateToVersion1(legacy);
    migrateToVersion2(legacy);
    legacy.pragma('user_version = 2');
    legacy.pragma('foreign_keys = ON');
    const now = '2026-07-15T12:00:00.000Z';
    legacy
      .prepare(
        'INSERT INTO notebooks (id, name, settings_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run('notebook', 'Atlas', 'null', now, now);
    legacy
      .prepare(
        'INSERT INTO sources (id, notebook_id, title, slug, file_path, origin_json, conversion_notes_json, word_count, content_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
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
    legacy
      .prepare(
        'INSERT INTO chats (id, notebook_id, title, source_ids_json, provider_override_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run('chat', 'notebook', 'Continuity', '["source"]', 'null', now, now);
    legacy
      .prepare(
        'INSERT INTO messages (id, chat_id, seq, role, content, reasoning, status, context_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run('message', 'chat', 0, 'user', 'Hello', null, 'complete', 'null', now);
    legacy.close();

    const migrated = openDatabase(dataDir);
    expect(migrated.pragma('user_version', { simple: true })).toBe(3);
    expect(migrated.prepare('SELECT id, name FROM notebooks').get()).toEqual({
      id: 'notebook',
      name: 'Atlas',
    });
    expect(migrated.prepare('SELECT id, title FROM sources').get()).toEqual({
      id: 'source',
      title: 'Lore',
    });
    expect(migrated.prepare('SELECT id, title, preset_id FROM chats').get()).toEqual({
      id: 'chat',
      title: 'Continuity',
      preset_id: null,
    });
    expect(migrated.prepare('SELECT id, content FROM messages').get()).toEqual({
      id: 'message',
      content: 'Hello',
    });
    expect(migrated.prepare('SELECT count(*) FROM presets').pluck().get()).toBe(1);
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
    future.pragma('user_version = 4');
    future.close();

    expect(() => openDatabase(dataDir)).toThrow(/newer schema version 4/u);

    const unchanged = new Database(file);
    expect(unchanged.pragma('user_version', { simple: true })).toBe(4);
    unchanged.close();
  });
});
