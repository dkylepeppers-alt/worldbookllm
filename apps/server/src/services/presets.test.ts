import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { PortablePreset } from '@worldbookllm/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../db/database.js';
import { ConflictError, InvalidStoredDataError, NotFoundError } from '../errors.js';
import { PresetService } from './presets.js';

const NOW = '2026-07-15T12:00:00.000Z';
const NOTEBOOK_ID = 'a0c7607c-b365-438b-a7e6-31b2308464b6';

const tempDirs: string[] = [];

const portablePreset: PortablePreset = {
  schemaVersion: 1,
  name: 'Focused drafting',
  generation: {
    temperature: 0.8,
    topP: 0.9,
    maxTokens: 2048,
    assistantPrefill: null,
  },
  modules: [
    {
      key: 'assistant-role',
      name: 'Assistant role',
      kind: 'custom',
      role: 'system',
      content: 'Draft carefully.',
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
  ],
};

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), 'worldbookllm-presets-'));
  tempDirs.push(dataDir);
  const db = openDatabase(dataDir);
  return { db, presets: new PresetService(db, () => NOW) };
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('PresetService', () => {
  it('lists the seed and creates and gets a strict portable preset', () => {
    const { db, presets } = setup();
    expect(presets.list()).toHaveLength(1);

    const created = presets.create(portablePreset);
    expect(created).toEqual({
      id: expect.any(String),
      ...portablePreset,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(presets.get(created.id)).toEqual(created);
    expect(presets.list()).toEqual(expect.arrayContaining([created]));
    db.close();
  });

  it('suffixes case-insensitive create collisions with the first available number', () => {
    const { db, presets } = setup();
    const first = presets.create(portablePreset);
    const second = presets.create({ ...portablePreset, name: 'focused DRAFTING' });
    presets.create({ ...portablePreset, name: 'Focused drafting (4)' });
    const third = presets.create(portablePreset);

    expect(first.name).toBe('Focused drafting');
    expect(second.name).toBe('focused DRAFTING (2)');
    expect(third.name).toBe('Focused drafting (3)');
    db.close();
  });

  it('keeps suffixed create and patch collision names within the 200-character limit', () => {
    const { db, presets } = setup();
    const upperName = 'A'.repeat(200);
    const lowerName = 'a'.repeat(200);
    presets.create({ ...portablePreset, name: upperName });

    const duplicate = presets.create({ ...portablePreset, name: lowerName });
    expect(duplicate.name).toBe(`${'a'.repeat(196)} (2)`);
    expect(duplicate.name).toHaveLength(200);

    const renamed = presets.patch(presets.create({ ...portablePreset, name: 'Other' }).id, {
      name: lowerName,
    });
    expect(renamed.name).toBe(`${'a'.repeat(196)} (3)`);
    expect(renamed.name).toHaveLength(200);
    db.close();
  });

  it('patches by merging a complete portable definition and suffixes name collisions', () => {
    const { db, presets } = setup();
    const first = presets.create(portablePreset);
    const second = presets.create({ ...portablePreset, name: 'Other' });

    const patched = presets.patch(first.id, {
      generation: { ...portablePreset.generation, temperature: 1.1 },
    });
    expect(patched).toMatchObject({
      name: portablePreset.name,
      generation: { ...portablePreset.generation, temperature: 1.1 },
      modules: portablePreset.modules,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(presets.patch(second.id, { name: 'FOCUSED DRAFTING' }).name).toBe(
      'FOCUSED DRAFTING (2)',
    );
    db.close();
  });

  it('resolves explicit and inherited presets and updates the singleton default', () => {
    const { db, presets } = setup();
    const initialSettings = presets.getSettings();
    const seed = presets.get(initialSettings.defaultPresetId);
    const created = presets.create(portablePreset);

    expect(presets.resolve(null)).toEqual(seed);
    expect(presets.resolve(created.id)).toEqual(created);
    expect(presets.setDefault(created.id)).toEqual({ defaultPresetId: created.id });
    expect(presets.getSettings()).toEqual({ defaultPresetId: created.id });
    expect(presets.resolve(null)).toEqual(created);
    db.close();
  });

  it('rejects deleting the default and clears chat references when deleting another preset', () => {
    const { db, presets } = setup();
    const defaultId = presets.getSettings().defaultPresetId;
    expect(() => presets.delete(defaultId)).toThrow(ConflictError);

    const created = presets.create(portablePreset);
    db.prepare(
      'INSERT INTO notebooks (id, name, settings_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(NOTEBOOK_ID, 'Atlas', 'null', NOW, NOW);
    db.prepare(
      'INSERT INTO chats (id, notebook_id, title, source_ids_json, provider_override_json, preset_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('chat', NOTEBOOK_ID, 'Draft', '[]', 'null', created.id, NOW, NOW);

    presets.delete(created.id);
    expect(db.prepare('SELECT preset_id FROM chats WHERE id = ?').get('chat')).toEqual({
      preset_id: null,
    });
    expect(() => presets.get(created.id)).toThrow(NotFoundError);
    db.close();
  });

  it('reports missing IDs consistently without partial writes', () => {
    const { db, presets } = setup();
    const missing = '62455a02-2fe1-4b6d-a6ce-4517bf06ada7';
    expect(() => presets.get(missing)).toThrow(NotFoundError);
    expect(() => presets.patch(missing, { name: 'Missing' })).toThrow(NotFoundError);
    expect(() => presets.delete(missing)).toThrow(NotFoundError);
    expect(() => presets.setDefault(missing)).toThrow(NotFoundError);
    expect(() => presets.resolve(missing)).toThrow(NotFoundError);
    expect(presets.list()).toHaveLength(1);
    db.close();
  });

  it('turns corrupt persisted definitions and settings into stored-data errors', () => {
    const { db, presets } = setup();
    const defaultId = presets.getSettings().defaultPresetId;
    db.prepare('UPDATE presets SET definition_json = ? WHERE id = ?').run(
      JSON.stringify({ schemaVersion: 1, name: 'Broken', surprise: true }),
      defaultId,
    );
    expect(() => presets.get(defaultId)).toThrow(InvalidStoredDataError);

    db.pragma('foreign_keys = OFF');
    db.prepare('UPDATE app_settings SET default_preset_id = ? WHERE id = 1').run('not-a-uuid');
    db.pragma('foreign_keys = ON');
    expect(() => presets.getSettings()).toThrow(InvalidStoredDataError);
    db.close();
  });
});
