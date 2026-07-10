import { describe, expect, it } from 'vitest';

import { ProviderError, type ProviderHttpRequest } from '@worldbookllm/providers';

import { ProviderHttpClient } from './http-client.js';

const request: ProviderHttpRequest = {
  url: 'https://example.test/models',
  method: 'POST',
  headers: { Authorization: 'Bearer super-secret' },
  body: { hello: 'world' },
};

describe('ProviderHttpClient', () => {
  it('encodes object bodies and parses successful JSON', async () => {
    let init: RequestInit | undefined;
    const client = new ProviderHttpClient(async (_input, options) => {
      init = options;
      return new Response(JSON.stringify({ data: [{ id: 'model' }] }), {
        headers: { 'content-type': 'application/json' },
      });
    });
    await expect(client.fetchJson('nanogpt', request)).resolves.toEqual({
      data: [{ id: 'model' }],
    });
    expect(init).toMatchObject({
      method: 'POST',
      body: '{"hello":"world"}',
      headers: expect.objectContaining({ 'content-type': 'application/json' }),
    });
  });

  it('sanitizes credential values in provider errors', async () => {
    const client = new ProviderHttpClient(async () =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { message: 'bad super-secret' } }), { status: 401 }),
      ),
    );
    let caught: unknown;
    try {
      await client.fetchJson('nanogpt', request);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProviderError);
    expect(String(caught)).toContain('[redacted]');
    expect(String(caught)).not.toContain('super-secret');
    expect((caught as ProviderError).statusCode).toBe(401);
  });

  it('rejects malformed and oversized JSON responses', async () => {
    const malformed = new ProviderHttpClient(async () => Promise.resolve(new Response('{bad')));
    await expect(malformed.fetchJson('nanogpt', request)).rejects.toThrow(ProviderError);

    const oversized = new ProviderHttpClient(async () =>
      Promise.resolve(new Response('x'.repeat(2 * 1024 * 1024 + 1))),
    );
    await expect(oversized.fetchJson('nanogpt', request)).rejects.toThrow(/too large/u);
  });

  it('returns streaming bodies and rejects missing bodies', async () => {
    const streaming = new ProviderHttpClient(async () =>
      Promise.resolve(new Response('data: x\n\n')),
    );
    await expect(
      streaming.fetchStream('nanogpt', request, new AbortController().signal),
    ).resolves.toBeTruthy();

    const missing = new ProviderHttpClient(async () =>
      Promise.resolve(new Response(null, { status: 200 })),
    );
    await expect(
      missing.fetchStream('nanogpt', request, new AbortController().signal),
    ).rejects.toThrow(/streaming body/u);
  });

  it('normalizes fetch rejections as provider errors', async () => {
    const client = new ProviderHttpClient(async () => Promise.reject(new Error('socket failed')));
    await expect(client.fetchJson('nanogpt', request)).rejects.toBeInstanceOf(ProviderError);
    await expect(
      client.fetchStream('nanogpt', request, new AbortController().signal),
    ).rejects.toBeInstanceOf(ProviderError);
  });
});
