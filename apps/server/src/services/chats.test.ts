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
      'INSERT INTO sources (id, notebook_id, title, slug, file_path, origin, word_count, content_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      id,
      notebookId,
      'Lore',
      'lore',
      `notebooks/${notebookId}/sources/${id}-lore.md`,
      'paste',
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
      providerOverride: null,
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
        title: 'Missing',
        sourceIds: [],
        providerOverride: null,
      }),
    ).toThrow(NotFoundError);
    const created = chats.create('a0c7607c-b365-438b-a7e6-31b2308464b6', {
      title: 'Chat',
      sourceIds: [],
      providerOverride: null,
    });
    expect(() =>
      chats.patch(created.id, { sourceIds: ['81c27453-f02c-4177-8414-dc644e6d1757'] }),
    ).toThrow(NotFoundError);
    db.close();
  });

  it('maps corrupt stored JSON to an internal stored-data error', () => {
    const { db, chats } = setup();
    const created = chats.create('a0c7607c-b365-438b-a7e6-31b2308464b6', {
      title: 'Chat',
      sourceIds: [],
      providerOverride: null,
    });
    db.prepare('UPDATE chats SET source_ids_json = ? WHERE id = ?').run('{broken', created.id);
    expect(() => chats.get(created.id)).toThrow(InvalidStoredDataError);
    db.close();
  });

  it('allocates adjacent message sequences and updates assistants', () => {
    const { db, chats } = setup();
    const chat = chats.create('a0c7607c-b365-438b-a7e6-31b2308464b6', {
      title: 'Chat',
      sourceIds: ['f9942d0a-eaca-41a8-a3d8-87987cc173fd'],
      providerOverride: null,
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

  it('deletes chats with cascading messages', () => {
    const { db, chats } = setup();
    const chat = chats.create('a0c7607c-b365-438b-a7e6-31b2308464b6', {
      title: 'Chat',
      sourceIds: [],
      providerOverride: null,
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
});
