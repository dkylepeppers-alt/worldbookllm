import type { Notebook, SourceDetail, SourceMetadata } from '@worldbookllm/shared';
import { describe, expect, it, vi } from 'vitest';

import { ApiClientError, createApiClient } from './client.js';

const notebook: Notebook = {
  id: 'a0c7607c-b365-438b-a7e6-31b2308464b6',
  name: 'Atlas',
  settings: null,
  createdAt: '2026-07-10T12:00:00.000Z',
  updatedAt: '2026-07-10T12:00:00.000Z',
};

const source: SourceMetadata = {
  id: 'f9942d0a-eaca-41a8-a3d8-87987cc173fd',
  notebookId: notebook.id,
  title: 'First light',
  slug: 'first-light',
  filePath: `notebooks/${notebook.id}/sources/f9942d0a-eaca-41a8-a3d8-87987cc173fd-first-light.md`,
  origin: 'paste',
  wordCount: 4,
  contentHash: 'a'.repeat(64),
  createdAt: '2026-07-10T12:00:00.000Z',
  updatedAt: '2026-07-10T12:00:00.000Z',
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('API client', () => {
  it('parses notebook collection responses', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([notebook]));

    await expect(createApiClient(fetchImpl).listNotebooks()).resolves.toEqual([notebook]);
    expect(fetchImpl).toHaveBeenCalledWith('/api/notebooks', {
      headers: { Accept: 'application/json' },
      signal: undefined,
    });
  });

  it('sends notebook mutations as JSON and handles deletion', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(notebook, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ ...notebook, name: 'Revised atlas' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = createApiClient(fetchImpl);

    await expect(client.createNotebook({ name: 'Atlas' })).resolves.toEqual(notebook);
    await expect(client.updateNotebook(notebook.id, { name: 'Revised atlas' })).resolves.toEqual({
      ...notebook,
      name: 'Revised atlas',
    });
    await expect(client.deleteNotebook(notebook.id)).resolves.toBeUndefined();

    expect(fetchImpl).toHaveBeenNthCalledWith(1, '/api/notebooks', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Atlas' }),
      signal: undefined,
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(2, `/api/notebooks/${notebook.id}`, {
      method: 'PATCH',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Revised atlas' }),
      signal: undefined,
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(3, `/api/notebooks/${notebook.id}`, {
      method: 'DELETE',
      headers: { Accept: 'application/json' },
      signal: undefined,
    });
  });

  it('covers notebook detail and every source operation', async () => {
    const detail: SourceDetail = { ...source, content: '# First light' };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(notebook))
      .mockResolvedValueOnce(jsonResponse([source]))
      .mockResolvedValueOnce(jsonResponse(source, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse(detail))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = createApiClient(fetchImpl);

    await expect(client.getNotebook(notebook.id)).resolves.toEqual(notebook);
    await expect(client.listSources(notebook.id)).resolves.toEqual([source]);
    await expect(
      client.createSource(notebook.id, { title: source.title, content: detail.content }),
    ).resolves.toEqual(source);
    await expect(client.getSource(source.id)).resolves.toEqual(detail);
    await expect(client.deleteSource(source.id)).resolves.toBeUndefined();

    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      `/api/notebooks/${notebook.id}`,
      `/api/notebooks/${notebook.id}/sources`,
      `/api/notebooks/${notebook.id}/sources`,
      `/api/sources/${source.id}`,
      `/api/sources/${source.id}`,
    ]);
  });

  it('normalizes server error responses', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          error: 'validation_error',
          message: 'Invalid request',
          issues: [{ code: 'too_small', path: ['name'], message: 'Required' }],
        },
        { status: 400 },
      ),
    );

    const error = await createApiClient(fetchImpl)
      .createNotebook({ name: '' })
      .catch((value) => value);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({
      status: 400,
      code: 'validation_error',
      message: 'Invalid request',
      issues: [{ code: 'too_small', path: ['name'], message: 'Required' }],
    });
  });

  it('rejects malformed successful responses', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ notebooks: [] }));

    await expect(createApiClient(fetchImpl).listNotebooks()).rejects.toMatchObject({
      status: 200,
      code: 'invalid_response',
      message: 'The server returned an invalid response.',
    });
  });

  it('normalizes network failures but preserves abort errors', async () => {
    const networkFetch = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));
    await expect(createApiClient(networkFetch).listNotebooks()).rejects.toMatchObject({
      status: 0,
      code: 'network_error',
      message: 'Could not reach the server.',
    });

    const abort = new DOMException('Aborted', 'AbortError');
    const abortFetch = vi.fn<typeof fetch>().mockRejectedValue(abort);
    const signal = new AbortController().signal;
    await expect(createApiClient(abortFetch).listNotebooks(signal)).rejects.toBe(abort);
    expect(abortFetch).toHaveBeenCalledWith('/api/notebooks', expect.objectContaining({ signal }));
  });
});
