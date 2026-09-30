import type {
  AppSettings,
  BookSummary,
  MaskedSecret,
  NotebookMigrationReport,
  ProviderCatalogEntry,
} from '@worldbookllm/shared';
import { DEFAULT_AGENT_GENERATION } from '@worldbookllm/shared';
import { describe, expect, it, vi } from 'vitest';

import { ApiClientError, createApiClient } from './client.js';

const book: BookSummary = {
  slug: 'the-salt-road',
  title: 'The Salt Road',
  genre: null,
  status: null,
  seriesId: null,
  bookNumber: null,
  counts: {},
  updatedAt: '2026-07-10T12:00:00.000Z',
};

const provider: ProviderCatalogEntry = {
  source: 'nanogpt',
  label: 'NanoGPT',
  family: 'openai-compat',
  secretKey: 'api_key_nanogpt',
  modelSource: 'live',
  hasSecret: true,
};

const secret: MaskedSecret = {
  id: '17ffda6c-8021-4af4-87a5-a652bcdfddb7',
  value: 'sk-…last',
  label: 'Primary',
  active: true,
};

const appSettings: AppSettings = {
  providerConfig: null,
  agentReviewMode: false,
  agentGeneration: DEFAULT_AGENT_GENERATION,
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('API client', () => {
  it('stops a chat’s running turn with an empty 204 response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const chatId = '99999999-9999-4999-8999-999999999999';

    await expect(createApiClient(fetchImpl).stopAgentChat(chatId)).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith(
      `/api/agent-chats/${chatId}/stop`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('parses book collection responses', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([book]));

    await expect(createApiClient(fetchImpl).listBooks()).resolves.toEqual([book]);
    expect(fetchImpl).toHaveBeenCalledWith('/api/books', {
      headers: { Accept: 'application/json' },
      signal: undefined,
    });
  });

  it('normalizes server error responses', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          error: 'validation_error',
          message: 'Invalid request',
          issues: [{ code: 'too_small', path: ['title'], message: 'Required' }],
        },
        { status: 400 },
      ),
    );

    const error = await createApiClient(fetchImpl)
      .createBook({ title: '' })
      .catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({
      status: 400,
      code: 'validation_error',
      message: 'Invalid request',
      issues: [{ code: 'too_small', path: ['title'], message: 'Required' }],
    });
  });

  it('covers provider and secret operations', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse([provider]))
      .mockResolvedValueOnce(jsonResponse({ models: [{ id: 'model-1', name: 'Model One' }] }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, detail: 'Connection succeeded.' }))
      .mockResolvedValueOnce(jsonResponse({ api_key_nanogpt: [secret] }))
      .mockResolvedValueOnce(jsonResponse(secret, { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = createApiClient(fetchImpl);

    await expect(client.getProviderCatalog()).resolves.toEqual([provider]);
    await expect(client.listModels({ source: 'nanogpt' })).resolves.toEqual({
      models: [{ id: 'model-1', name: 'Model One' }],
    });
    await expect(client.testConnection({ source: 'nanogpt', model: 'model-1' })).resolves.toEqual({
      ok: true,
      detail: 'Connection succeeded.',
    });
    await expect(client.getSecrets()).resolves.toEqual({ api_key_nanogpt: [secret] });
    await expect(
      client.createSecret({ key: provider.secretKey, value: 'sk-private' }),
    ).resolves.toEqual(secret);
    await expect(client.activateSecret('key/with slash', secret.id)).resolves.toBeUndefined();
    await expect(client.deleteSecret(provider.secretKey, secret.id)).resolves.toBeUndefined();

    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      '/api/providers',
      '/api/providers/models',
      '/api/providers/test',
      '/api/secrets',
      '/api/secrets',
      `/api/secrets/key%2Fwith%20slash/${secret.id}/activate`,
      `/api/secrets/${provider.secretKey}/${secret.id}`,
    ]);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      '/api/providers/models',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ source: 'nanogpt' }) }),
    );
  });

  it('covers app settings and the notebook migration report', async () => {
    const report: NotebookMigrationReport = {
      entries: [
        {
          notebookName: 'Harbor',
          bookSlug: 'harbor',
          migratedAt: '2026-09-30T12:00:00.000Z',
          sourceCount: 2,
          fileCount: 2,
          chatCount: 1,
          error: null,
        },
      ],
      archivePath: 'notebooks.migrated',
      seen: false,
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(appSettings))
      .mockResolvedValueOnce(jsonResponse({ ...appSettings, agentReviewMode: true }))
      .mockResolvedValueOnce(jsonResponse(report))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = createApiClient(fetchImpl);

    await expect(client.getAppSettings()).resolves.toEqual(appSettings);
    await expect(client.updateAppSettings({ agentReviewMode: true })).resolves.toMatchObject({
      agentReviewMode: true,
    });
    await expect(client.getNotebookMigration()).resolves.toEqual(report);
    await expect(client.markNotebookMigrationSeen()).resolves.toBeUndefined();
    expect(fetchImpl.mock.calls.map(([url, init]) => [url, init?.method ?? 'GET'])).toEqual([
      ['/api/app-settings', 'GET'],
      ['/api/app-settings', 'PATCH'],
      ['/api/notebook-migration', 'GET'],
      ['/api/notebook-migration/seen', 'POST'],
    ]);
  });

  it('rejects malformed successful responses', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ books: [] }));

    await expect(createApiClient(fetchImpl).listBooks()).rejects.toMatchObject({
      status: 200,
      code: 'invalid_response',
      message: 'The server returned an invalid response.',
    });
  });

  it('normalizes network failures but preserves abort errors', async () => {
    const networkFetch = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));
    await expect(createApiClient(networkFetch).listBooks()).rejects.toMatchObject({
      status: 0,
      code: 'network_error',
      message: 'Could not reach the server.',
    });

    const abort = new DOMException('Aborted', 'AbortError');
    const abortFetch = vi.fn<typeof fetch>().mockRejectedValue(abort);
    const signal = new AbortController().signal;
    await expect(createApiClient(abortFetch).listBooks(signal)).rejects.toBe(abort);
    expect(abortFetch).toHaveBeenCalledWith('/api/books', expect.objectContaining({ signal }));
  });
});
