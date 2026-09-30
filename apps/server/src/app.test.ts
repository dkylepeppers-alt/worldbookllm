import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import type { AgentChat, BookSummary } from '@worldbookllm/shared';
import type { FastifyInstance } from 'fastify';
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

  it('keeps the health endpoint available', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
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

  it('exposes provider catalog and static model routes without secret values', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/secrets',
      payload: { key: 'api_key_nanogpt', value: 'provider-route-secret', label: 'Primary' },
    });
    const catalog = await app.inject({ method: 'GET', url: '/api/providers' });
    expect(catalog.statusCode).toBe(200);
    expect(catalog.body).not.toContain('provider-route-secret');
    expect(catalog.json<Array<{ source: string; hasSecret: boolean }>>()).toEqual(
      expect.arrayContaining([expect.objectContaining({ source: 'nanogpt', hasSecret: true })]),
    );

    const models = await app.inject({
      method: 'POST',
      url: '/api/providers/models',
      payload: { source: 'claude' },
    });
    expect(models.statusCode).toBe(200);
    expect(models.json<{ models: unknown[] }>().models.length).toBeGreaterThan(0);
  });

  it('returns a configuration error when a provider key is missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/providers/models',
      payload: { source: 'nanogpt' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: 'configuration_error',
      message: 'NanoGPT requires an API key.',
    });
  });

  it('reopens one data directory without losing persisted state', async () => {
    const book = (
      await app.inject({ method: 'POST', url: '/api/books', payload: { title: 'Persistent' } })
    ).json<BookSummary>();
    const chat = (
      await app.inject({ method: 'POST', url: `/api/books/${book.slug}/agent-chats`, payload: {} })
    ).json<AgentChat>();
    await app.close();
    app = buildApp({ dataDir, logger: false });

    const response = await app.inject({ method: 'GET', url: `/api/agent-chats/${chat.id}` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: chat.id, book: book.slug });

    const db = new Database(join(dataDir, 'worldbookllm.db'), { readonly: true });
    expect(db.pragma('user_version', { simple: true })).toBe(14);
    db.close();
  });

  it('no longer serves the notebook-era API', async () => {
    for (const url of ['/api/notebooks', '/api/presets', '/api/skills-starter']) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(404);
    }
  });
});
