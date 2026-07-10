import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import matter from 'gray-matter';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';

describe('server data API', () => {
  let app: FastifyInstance;
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'worldbookllm-app-'));
    app = buildApp({ dataDir, logger: false });
  });

  afterEach(async () => {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function createNotebook(name = 'Atlas') {
    const response = await app.inject({
      method: 'POST',
      url: '/api/notebooks',
      payload: { name },
    });
    expect(response.statusCode).toBe(201);
    return response.json<{
      id: string;
      name: string;
      settings: unknown;
      createdAt: string;
      updatedAt: string;
    }>();
  }

  it('keeps the health endpoint available', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('creates, lists, reads, and patches notebooks', async () => {
    const notebook = await createNotebook(' Atlas ');
    expect(notebook).toEqual({
      id: expect.any(String),
      name: 'Atlas',
      settings: null,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });

    const list = await app.inject({ method: 'GET', url: '/api/notebooks' });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual([notebook]);

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/notebooks/${notebook.id}`,
      payload: {
        name: 'Revised Atlas',
        settings: { source: 'nanogpt', model: 'meta/llama' },
      },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json()).toEqual({
      ...notebook,
      name: 'Revised Atlas',
      settings: { source: 'nanogpt', model: 'meta/llama' },
      updatedAt: expect.any(String),
    });

    const detail = await app.inject({
      method: 'GET',
      url: `/api/notebooks/${notebook.id}`,
    });
    expect(detail.json()).toEqual(patch.json());
  });

  it('returns stable validation and not-found errors', async () => {
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/notebooks',
      payload: { name: '' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toEqual({
      error: 'validation_error',
      message: 'Invalid request',
      issues: expect.any(Array),
    });

    const emptyPatch = await app.inject({
      method: 'PATCH',
      url: '/api/notebooks/f9942d0a-eaca-41a8-a3d8-87987cc173fd',
      payload: {},
    });
    expect(emptyPatch.statusCode).toBe(400);

    const missing = await app.inject({
      method: 'GET',
      url: '/api/notebooks/f9942d0a-eaca-41a8-a3d8-87987cc173fd',
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({
      error: 'not_found',
      message: 'Notebook f9942d0a-eaca-41a8-a3d8-87987cc173fd was not found',
    });
  });

  it('persists pasted sources as Markdown and keeps content out of SQLite', async () => {
    const notebook = await createNotebook();
    const create = await app.inject({
      method: 'POST',
      url: `/api/notebooks/${notebook.id}/sources`,
      payload: { title: 'Amber Court', content: '# Court\n\nAmber rules here.' },
    });
    expect(create.statusCode).toBe(201);
    const source = create.json<{
      id: string;
      notebookId: string;
      title: string;
      slug: string;
      filePath: string;
      wordCount: number;
      contentHash: string;
      origin: string;
      createdAt: string;
      updatedAt: string;
    }>();
    expect(source).toEqual({
      id: expect.any(String),
      notebookId: notebook.id,
      title: 'Amber Court',
      slug: 'amber-court',
      filePath: expect.stringMatching(/\.md$/u),
      origin: 'paste',
      wordCount: 5,
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });

    const markdown = readFileSync(join(dataDir, source.filePath), 'utf8');
    expect(matter(markdown).data).toMatchObject({
      id: source.id,
      notebookId: notebook.id,
      title: 'Amber Court',
      origin: 'paste',
    });

    const list = await app.inject({
      method: 'GET',
      url: `/api/notebooks/${notebook.id}/sources`,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual([source]);
    expect(list.body).not.toContain('# Court');

    const detail = await app.inject({ method: 'GET', url: `/api/sources/${source.id}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toEqual({ ...source, content: '# Court\n\nAmber rules here.' });

    const db = new Database(join(dataDir, 'worldbookllm.db'), { readonly: true });
    const columns = db.prepare('PRAGMA table_info(sources)').all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).not.toContain('content');
    db.close();
  });

  it('reconciles source title, body metadata, and timestamp after external edits', async () => {
    const notebook = await createNotebook();
    const create = await app.inject({
      method: 'POST',
      url: `/api/notebooks/${notebook.id}/sources`,
      payload: { title: 'Old title', content: 'old body' },
    });
    const source = create.json<{ id: string; filePath: string }>();
    const absolutePath = join(dataDir, source.filePath);
    const parsed = matter(readFileSync(absolutePath, 'utf8'));
    parsed.data.title = 'External title';
    parsed.data.updatedAt = '2026-07-10T18:00:00.000Z';
    const edited = matter
      .stringify('five newly edited body words', parsed.data)
      .replace(/\n$/u, '');
    writeFileSync(absolutePath, edited, { mode: 0o600 });

    const detail = await app.inject({ method: 'GET', url: `/api/sources/${source.id}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      title: 'External title',
      content: 'five newly edited body words',
      wordCount: 5,
      updatedAt: '2026-07-10T18:00:00.000Z',
    });

    const db = new Database(join(dataDir, 'worldbookllm.db'), { readonly: true });
    expect(
      db.prepare('SELECT title, word_count, updated_at FROM sources WHERE id = ?').get(source.id),
    ).toEqual({
      title: 'External title',
      word_count: 5,
      updated_at: '2026-07-10T18:00:00.000Z',
    });
    db.close();
  });

  it('treats invalid stored source metadata as an internal error, not bad client input', async () => {
    const notebook = await createNotebook();
    await app.inject({
      method: 'POST',
      url: `/api/notebooks/${notebook.id}/sources`,
      payload: { title: 'Valid title', content: 'body' },
    });
    const db = new Database(join(dataDir, 'worldbookllm.db'));
    db.prepare('UPDATE sources SET title = ?').run('');
    db.close();

    const response = await app.inject({
      method: 'GET',
      url: `/api/notebooks/${notebook.id}/sources`,
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: 'internal_error',
      message: 'Internal server error',
    });
  });

  it('deletes source files and cascades notebook state', async () => {
    const notebook = await createNotebook();
    const first = await app.inject({
      method: 'POST',
      url: `/api/notebooks/${notebook.id}/sources`,
      payload: { title: 'First', content: 'first body' },
    });
    const source = first.json<{ id: string; filePath: string }>();
    const absolutePath = join(dataDir, source.filePath);

    const deleteSource = await app.inject({ method: 'DELETE', url: `/api/sources/${source.id}` });
    expect(deleteSource.statusCode).toBe(204);
    expect(existsSync(absolutePath)).toBe(false);

    await app.inject({
      method: 'POST',
      url: `/api/notebooks/${notebook.id}/sources`,
      payload: { title: 'Second', content: 'second body' },
    });
    const notebookDirectory = join(dataDir, 'notebooks', notebook.id);
    const deleteNotebook = await app.inject({
      method: 'DELETE',
      url: `/api/notebooks/${notebook.id}`,
    });
    expect(deleteNotebook.statusCode).toBe(204);
    expect(existsSync(notebookDirectory)).toBe(false);

    const db = new Database(join(dataDir, 'worldbookllm.db'), { readonly: true });
    expect(db.prepare('SELECT count(*) FROM sources').pluck().get()).toBe(0);
    expect(db.prepare('SELECT count(*) FROM notebooks').pluck().get()).toBe(0);
    db.close();
  });

  it('manages multiple secrets without returning raw values', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/api/secrets',
      payload: { key: 'api_key_nanogpt', value: 'first-secret-value', label: 'First' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/secrets',
      payload: { key: 'api_key_nanogpt', value: 'second-secret-value', label: 'Second' },
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    const firstEntry = first.json<{ id: string }>();
    const secondEntry = second.json<{ id: string }>();
    expect(first.body).not.toContain('first-secret-value');
    expect(second.body).not.toContain('second-secret-value');

    const activate = await app.inject({
      method: 'POST',
      url: `/api/secrets/api_key_nanogpt/${firstEntry.id}/activate`,
    });
    expect(activate.statusCode).toBe(204);

    const state = await app.inject({ method: 'GET', url: '/api/secrets' });
    expect(state.statusCode).toBe(200);
    expect(state.body).not.toContain('secret-value');
    expect(state.json()).toEqual({
      api_key_nanogpt: [
        expect.objectContaining({ id: firstEntry.id, active: true }),
        expect.objectContaining({ id: secondEntry.id, active: false }),
      ],
    });

    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/secrets/api_key_nanogpt/${firstEntry.id}`,
    });
    expect(remove.statusCode).toBe(204);
    const fallback = await app.inject({ method: 'GET', url: '/api/secrets' });
    expect(fallback.json()).toEqual({
      api_key_nanogpt: [expect.objectContaining({ id: secondEntry.id, active: true })],
    });
  });

  it('reopens one data directory without losing persisted state', async () => {
    const notebook = await createNotebook('Persistent');
    await app.close();
    app = buildApp({ dataDir, logger: false });

    const response = await app.inject({
      method: 'GET',
      url: `/api/notebooks/${notebook.id}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: notebook.id, name: 'Persistent' });

    const db = new Database(join(dataDir, 'worldbookllm.db'), { readonly: true });
    expect(db.pragma('user_version', { simple: true })).toBe(1);
    db.close();
  });
});
