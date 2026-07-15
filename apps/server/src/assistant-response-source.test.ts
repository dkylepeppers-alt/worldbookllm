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
    const origin = {
      type: 'assistant-response' as const,
      chatId: '60a0bf0c-031d-497c-9c1a-2f68441936a6',
      messageId: '3fdd7a3e-6d4e-4a56-a2a4-8b8a29f6d0cf',
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
});
