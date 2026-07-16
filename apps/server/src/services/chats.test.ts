import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { CreateChat, GenerationContext } from '@worldbookllm/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../db/database.js';
import { InvalidStoredDataError, NotFoundError } from '../errors.js';
import { ChatService } from './chats.js';

const tempDirs: string[] = [];

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), 'worldbookllm-chats-'));
  tempDirs.push(dataDir);
  const db = openDatabase(dataDir);
  const now = '2026-07-10T12:00:00.000Z';
  for (const [id, name] of [
    ['a0c7607c-b365-438b-a7e6-31b2308464b6', 'Atlas'],
    ['d8dc74cd-3f42-44b9-90df-7fde6e885f46', 'Other'],
  ]) {
    db.prepare(
      'INSERT INTO notebooks (id, name, settings_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(id, name, 'null', now, now);
  }
  const sources = [
    ['f9942d0a-eaca-41a8-a3d8-87987cc173fd', 'a0c7607c-b365-438b-a7e6-31b2308464b6'],
    ['81c27453-f02c-4177-8414-dc644e6d1757', 'd8dc74cd-3f42-44b9-90df-7fde6e885f46'],
  ];
  for (const [id, notebookId] of sources) {
    db.prepare(
      'INSERT INTO sources (id, notebook_id, title, slug, file_path, origin_json, conversion_notes_json, word_count, content_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      id,
      notebookId,
      'Lore',
      'lore',
      `notebooks/${notebookId}/sources/${id}-lore.md`,
      '{"type":"paste"}',
      '[]',
      1,
      'a'.repeat(64),
      now,
      now,
    );
  }
  return { db, chats: new ChatService(db, () => now), now };
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('ChatService', () => {
  it('creates, lists, reads, and patches chats', () => {
    const { db, chats, now } = setup();
    const input: CreateChat = {
      title: 'Continuity',
      sourceIds: ['f9942d0a-eaca-41a8-a3d8-87987cc173fd'],
      skillIds: [],
      providerOverride: null,
      presetId: null,
    };
    const created = chats.create('a0c7607c-b365-438b-a7e6-31b2308464b6', input);
    expect(created).toEqual({
      id: expect.any(String),
      notebookId: 'a0c7607c-b365-438b-a7e6-31b2308464b6',
      ...input,
      createdAt: now,
      updatedAt: now,
    });
    expect(chats.list(created.notebookId)).toEqual([created]);
    expect(chats.getDetail(created.id)).toEqual({ ...created, messages: [] });

    const patched = chats.patch(created.id, {
      title: 'Revised',
      providerOverride: { source: 'nanogpt', model: 'gpt-4o-mini' },
    });
    expect(patched).toMatchObject({
      title: 'Revised',
      sourceIds: input.sourceIds,
      providerOverride: { source: 'nanogpt', model: 'gpt-4o-mini' },
    });
    db.close();
  });

  it('rejects missing notebooks and sources from another notebook', () => {
    const { db, chats } = setup();
    expect(() =>
      chats.create('62455a02-2fe1-4b6d-a6ce-4517bf06ada7', {
        skillIds: [],
        title: 'Missing',
        sourceIds: [],
        providerOverride: null,
        presetId: null,
      }),
    ).toThrow(NotFoundError);
    const created = chats.create('a0c7607c-b365-438b-a7e6-31b2308464b6', {
      skillIds: [],
      title: 'Chat',
      sourceIds: [],
      providerOverride: null,
      presetId: null,
    });
    expect(() =>
      chats.patch(created.id, { sourceIds: ['81c27453-f02c-4177-8414-dc644e6d1757'] }),
    ).toThrow(NotFoundError);
    db.close();
  });

  it('validates and persists per-chat skill selections', () => {
    const { db, chats, now } = setup();
    db.prepare(
      'INSERT INTO skills (id, name, description, dir_path, origin_json, license, word_count, content_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      '2f1f6c15-9a71-4f5e-8f43-25c9d16f2a01',
      'character-voice',
      'Voices',
      'skills/character-voice',
      '{"type":"created"}',
      null,
      2,
      'b'.repeat(64),
      now,
      now,
    );

    expect(() =>
      chats.create('a0c7607c-b365-438b-a7e6-31b2308464b6', {
        title: 'Chat',
        sourceIds: [],
        skillIds: ['9c62ee9c-0f5f-4d33-9d61-1a2b3c4d5e6f'],
        providerOverride: null,
        presetId: null,
      }),
    ).toThrow(NotFoundError);

    const created = chats.create('a0c7607c-b365-438b-a7e6-31b2308464b6', {
      title: 'Chat',
      sourceIds: [],
      skillIds: ['2f1f6c15-9a71-4f5e-8f43-25c9d16f2a01'],
      providerOverride: null,
      presetId: null,
    });
    expect(created.skillIds).toEqual(['2f1f6c15-9a71-4f5e-8f43-25c9d16f2a01']);

    expect(() =>
      chats.patch(created.id, { skillIds: ['9c62ee9c-0f5f-4d33-9d61-1a2b3c4d5e6f'] }),
    ).toThrow(NotFoundError);
    expect(chats.patch(created.id, { skillIds: [] }).skillIds).toEqual([]);
    expect(chats.patch(created.id, { title: 'Renamed' }).skillIds).toEqual([]);
    db.close();
  });

  it('maps corrupt stored JSON to an internal stored-data error', () => {
    const { db, chats } = setup();
    const created = chats.create('a0c7607c-b365-438b-a7e6-31b2308464b6', {
      skillIds: [],
      title: 'Chat',
      sourceIds: [],
      providerOverride: null,
      presetId: null,
    });
    db.prepare('UPDATE chats SET source_ids_json = ? WHERE id = ?').run('{broken', created.id);
    expect(() => chats.get(created.id)).toThrow(InvalidStoredDataError);
    db.close();
  });

  it('allocates adjacent message sequences and updates assistants', () => {
    const { db, chats } = setup();
    const chat = chats.create('a0c7607c-b365-438b-a7e6-31b2308464b6', {
      skillIds: [],
      title: 'Chat',
      sourceIds: ['f9942d0a-eaca-41a8-a3d8-87987cc173fd'],
      providerOverride: null,
      presetId: null,
    });
    const context: GenerationContext = {
      sourceIds: chat.sourceIds,
      provider: 'nanogpt',
      model: 'gpt-4o-mini',
      strictness: 'grounded',
    };
    const first = chats.beginExchange(chat.id, 'Question one', context);
    const second = chats.beginExchange(chat.id, 'Question two', context);
    expect([first.user.seq, first.assistant.seq, second.user.seq, second.assistant.seq]).toEqual([
      0, 1, 2, 3,
    ]);
    expect(first.user).toMatchObject({
      role: 'user',
      status: 'complete',
      context: null,
      reasoning: null,
    });
    expect(first.assistant).toMatchObject({
      role: 'assistant',
      content: '',
      status: 'interrupted',
      context,
    });
    expect(
      chats.updateAssistant(first.assistant.id, {
        content: 'Answer',
        reasoning: 'Thought',
        status: 'complete',
      }),
    ).toMatchObject({ content: 'Answer', reasoning: 'Thought', status: 'complete' });
    expect(chats.getHistory(chat.id)).toHaveLength(4);
    db.close();
  });

  it('reads a pre-variants assistant message as a single implicit variant', () => {
    const { db, chats } = setup();
    const chat = chats.create('a0c7607c-b365-438b-a7e6-31b2308464b6', {
      skillIds: [],
      title: 'Chat',
      sourceIds: [],
      providerOverride: null,
      presetId: null,
    });
    const context: GenerationContext = {
      sourceIds: [],
      provider: 'nanogpt',
      model: 'gpt-4o-mini',
      strictness: 'grounded',
    };
    const { assistant } = chats.beginExchange(chat.id, 'Ask', context);
    const updated = chats.updateAssistant(assistant.id, {
      content: 'Answer one',
      reasoning: null,
      status: 'complete',
    });
    expect(updated.variants).toEqual([
      {
        content: 'Answer one',
        reasoning: null,
        status: 'complete',
        context,
        createdAt: updated.createdAt,
      },
    ]);
    expect(updated.activeVariant).toBe(0);
    db.close();
  });

  it('regenerates into new variants and switches the active one', () => {
    const { db, chats } = setup();
    const chat = chats.create('a0c7607c-b365-438b-a7e6-31b2308464b6', {
      skillIds: [],
      title: 'Chat',
      sourceIds: [],
      providerOverride: null,
      presetId: null,
    });
    const context: GenerationContext = {
      sourceIds: [],
      provider: 'nanogpt',
      model: 'gpt-4o-mini',
      strictness: 'grounded',
    };
    const { assistant } = chats.beginExchange(chat.id, 'Ask', context);
    chats.updateAssistant(assistant.id, { content: 'First', reasoning: null, status: 'complete' });

    const regenerating = chats.beginRegeneration(assistant.id, context);
    expect(regenerating).toMatchObject({ content: '', status: 'interrupted', activeVariant: 1 });
    expect(regenerating.variants).toHaveLength(2);
    expect(regenerating.variants?.[0]).toMatchObject({ content: 'First', status: 'complete' });

    const second = chats.updateAssistant(assistant.id, {
      content: 'Second',
      reasoning: 'thinking',
      status: 'complete',
    });
    // Only the active variant is rewritten; the earlier one is preserved.
    expect(second.content).toBe('Second');
    expect(second.variants?.[0]).toMatchObject({ content: 'First' });
    expect(second.variants?.[1]).toMatchObject({ content: 'Second', reasoning: 'thinking' });

    const back = chats.selectVariant(assistant.id, 0);
    expect(back).toMatchObject({ content: 'First', reasoning: null, activeVariant: 0 });
    // History mirrors the newly-selected active variant.
    const history = chats.getHistory(chat.id);
    expect(history.at(-1)).toMatchObject({ content: 'First', activeVariant: 0 });

    expect(() => chats.selectVariant(assistant.id, 5)).toThrow(NotFoundError);
    db.close();
  });

  it('rejects variant selection for a message that does not exist', () => {
    const { db, chats } = setup();
    const missing = '00000000-0000-4000-8000-000000000000';
    expect(() => chats.selectVariant(missing, 0)).toThrow(NotFoundError);
    db.close();
  });

  it('surfaces corrupt variant JSON as an internal stored-data error', () => {
    const { db, chats } = setup();
    const chat = chats.create('a0c7607c-b365-438b-a7e6-31b2308464b6', {
      skillIds: [],
      title: 'Chat',
      sourceIds: [],
      providerOverride: null,
      presetId: null,
    });
    const context: GenerationContext = {
      sourceIds: [],
      provider: 'nanogpt',
      model: 'gpt-4o-mini',
      strictness: 'grounded',
    };
    const { assistant } = chats.beginExchange(chat.id, 'Ask', context);
    db.prepare('UPDATE messages SET variants_json = ? WHERE id = ?').run('{broken', assistant.id);
    expect(() => chats.selectVariant(assistant.id, 0)).toThrow(InvalidStoredDataError);
    expect(() =>
      chats.updateAssistant(assistant.id, { content: 'x', reasoning: null, status: 'complete' }),
    ).toThrow(InvalidStoredDataError);
    db.close();
  });

  it('refuses to update an assistant whose active_variant is out of range', () => {
    const { db, chats, now } = setup();
    const chat = chats.create('a0c7607c-b365-438b-a7e6-31b2308464b6', {
      skillIds: [],
      title: 'Chat',
      sourceIds: [],
      providerOverride: null,
      presetId: null,
    });
    const { assistant } = chats.beginExchange(chat.id, 'Ask', {
      sourceIds: [],
      provider: 'nanogpt',
      model: 'gpt-4o-mini',
      strictness: 'grounded',
    });
    const oneVariant = JSON.stringify([
      { content: 'a', reasoning: null, status: 'complete', context: null, createdAt: now },
    ]);
    db.prepare('UPDATE messages SET variants_json = ?, active_variant = 5 WHERE id = ?').run(
      oneVariant,
      assistant.id,
    );
    expect(() =>
      chats.updateAssistant(assistant.id, { content: 'x', reasoning: null, status: 'complete' }),
    ).toThrow(InvalidStoredDataError);
    db.close();
  });

  it('deletes chats with cascading messages', () => {
    const { db, chats } = setup();
    const chat = chats.create('a0c7607c-b365-438b-a7e6-31b2308464b6', {
      skillIds: [],
      title: 'Chat',
      sourceIds: [],
      providerOverride: null,
      presetId: null,
    });
    chats.beginExchange(chat.id, 'Question', {
      sourceIds: [],
      provider: 'nanogpt',
      model: 'gpt-4o-mini',
      strictness: 'grounded',
    });
    chats.delete(chat.id);
    expect(db.prepare('SELECT count(*) FROM messages').pluck().get()).toBe(0);
    expect(() => chats.get(chat.id)).toThrow(NotFoundError);
    db.close();
  });

  it('persists nullable preset inheritance and validates explicit preset IDs', () => {
    const { db, chats } = setup();
    const defaultPresetId = db
      .prepare('SELECT default_preset_id FROM app_settings WHERE id = 1')
      .pluck()
      .get() as string;
    const explicit = chats.create('a0c7607c-b365-438b-a7e6-31b2308464b6', {
      skillIds: [],
      title: 'Explicit',
      sourceIds: [],
      providerOverride: null,
      presetId: defaultPresetId,
    });
    expect(explicit.presetId).toBe(defaultPresetId);

    expect(chats.patch(explicit.id, { presetId: null }).presetId).toBeNull();
    const missing = '62455a02-2fe1-4b6d-a6ce-4517bf06ada7';
    expect(() =>
      chats.create('a0c7607c-b365-438b-a7e6-31b2308464b6', {
        skillIds: [],
        title: 'Missing preset',
        sourceIds: [],
        providerOverride: null,
        presetId: missing,
      }),
    ).toThrow(NotFoundError);
    expect(() => chats.patch(explicit.id, { presetId: missing })).toThrow(NotFoundError);
    expect(chats.get(explicit.id).presetId).toBeNull();
    db.close();
  });
});
