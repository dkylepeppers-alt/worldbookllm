import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import matter from 'gray-matter';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';

describe('assistant-response source provenance', () => {
  let dataDir: string;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'worldbookllm-response-source-'));
    app = buildApp({ dataDir, logger: false });
  });

  afterEach(async () => {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('keeps assistant origin identical across API, SQLite, Markdown, and reconciled reads', async () => {
    const notebookResponse = await app.inject({
      method: 'POST',
      url: '/api/notebooks',
      payload: { name: 'Atlas' },
    });
    const notebookId = notebookResponse.json<{ id: string }>().id;
    const chatResponse = await app.inject({
      method: 'POST',
      url: `/api/notebooks/${notebookId}/chats`,
      payload: {},
    });
    const chatId = chatResponse.json<{ id: string }>().id;
    const exchange = app.services.chats.beginExchange(chatId, 'Question', {
      sourceIds: [],
      provider: 'nanogpt',
      model: 'gpt-4o-mini',
      strictness: 'grounded',
    });
    app.services.chats.updateAssistant(exchange.assistant.id, {
      content: 'Original answer.',
      reasoning: null,
      status: 'complete',
    });
    const origin = {
      type: 'assistant-response' as const,
      chatId,
      messageId: exchange.assistant.id,
    };

    const create = await app.inject({
      method: 'POST',
      url: `/api/notebooks/${notebookId}/sources`,
      payload: {
        title: 'Captured response',
        content: '# Captured\n\nOriginal answer.',
        origin,
        conversionNotes: [],
      },
    });

    expect(create.statusCode).toBe(201);
    const source = create.json<{ id: string; filePath: string; origin: unknown }>();
    expect(source.origin).toEqual(origin);

    const db = new Database(join(dataDir, 'worldbookllm.db'), { readonly: true });
    const row = db.prepare('SELECT origin_json FROM sources WHERE id = ?').get(source.id) as {
      origin_json: string;
    };
    db.close();
    expect(JSON.parse(row.origin_json)).toEqual(origin);

    const absolutePath = join(dataDir, source.filePath);
    const stored = matter(readFileSync(absolutePath, 'utf8'));
    expect(stored.data.origin).toEqual(origin);

    stored.data.title = 'Externally reviewed response';
    stored.data.updatedAt = '2026-07-15T12:00:00.000Z';
    writeFileSync(absolutePath, matter.stringify('# Reviewed\n\nEdited answer.', stored.data));

    const read = await app.inject({ method: 'GET', url: `/api/sources/${source.id}` });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({
      id: source.id,
      title: 'Externally reviewed response',
      content: '# Reviewed\n\nEdited answer.\n',
      origin,
    });
  });

  it('returns a safe not-found response for an invalid provenance claim', async () => {
    const notebook = await app.inject({
      method: 'POST',
      url: '/api/notebooks',
      payload: { name: 'Atlas' },
    });
    const notebookId = notebook.json<{ id: string }>().id;
    const create = await app.inject({
      method: 'POST',
      url: `/api/notebooks/${notebookId}/sources`,
      payload: {
        title: 'Forged response',
        content: 'No answer.',
        origin: {
          type: 'assistant-response',
          chatId: crypto.randomUUID(),
          messageId: crypto.randomUUID(),
        },
      },
    });

    expect(create.statusCode).toBe(404);
    expect(create.json()).toEqual({
      error: 'not_found',
      message: 'Assistant response was not found in this notebook',
    });
    const listed = await app.inject({
      method: 'GET',
      url: `/api/notebooks/${notebookId}/sources`,
    });
    expect(listed.json()).toEqual([]);
  });

  it('rejects whitespace-only assistant provenance before creating a row or Markdown file', async () => {
    const notebook = await app.inject({
      method: 'POST',
      url: '/api/notebooks',
      payload: { name: 'Atlas' },
    });
    const notebookId = notebook.json<{ id: string }>().id;
    const chat = await app.inject({
      method: 'POST',
      url: `/api/notebooks/${notebookId}/chats`,
      payload: {},
    });
    const chatId = chat.json<{ id: string }>().id;
    const exchange = app.services.chats.beginExchange(chatId, 'Question', {
      sourceIds: [],
      provider: 'nanogpt',
      model: 'gpt-4o-mini',
      strictness: 'grounded',
    });
    app.services.chats.updateAssistant(exchange.assistant.id, {
      content: ' \n\t ',
      reasoning: null,
      status: 'error',
    });

    const create = await app.inject({
      method: 'POST',
      url: `/api/notebooks/${notebookId}/sources`,
      payload: {
        title: 'Empty response',
        content: 'Must not persist',
        origin: {
          type: 'assistant-response',
          chatId,
          messageId: exchange.assistant.id,
        },
      },
    });

    expect(create.statusCode).toBe(404);
    expect(create.json()).toEqual({
      error: 'not_found',
      message: 'Assistant response was not found in this notebook',
    });
    const db = new Database(join(dataDir, 'worldbookllm.db'), { readonly: true });
    const count = db.prepare('SELECT count(*) AS count FROM sources').get() as { count: number };
    db.close();
    expect(count.count).toBe(0);
    expect(await app.services.sources.list(notebookId)).toEqual([]);
  });
});
