import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CHAT_COMPLETION_SOURCES } from '@worldbookllm/providers';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfigurationError } from '../errors.js';
import { ProviderHttpClient } from '../providers/http-client.js';
import { SecretStore } from '../secrets/secret-store.js';
import { ProviderService } from './providers.js';

const tempDirs: string[] = [];

function store(): SecretStore {
  const dataDir = mkdtempSync(join(tmpdir(), 'worldbookllm-provider-service-'));
  tempDirs.push(dataDir);
  return new SecretStore(dataDir);
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('ProviderService', () => {
  it('returns ordered metadata with secret presence but no values', () => {
    const secrets = store();
    secrets.add('api_key_nanogpt', 'raw-nanogpt-secret', 'Primary');
    const service = new ProviderService(
      secrets,
      new ProviderHttpClient(async () => Promise.reject(new Error('not called'))),
    );
    const catalog = service.getCatalog();
    expect(catalog.map((entry) => entry.source)).toEqual(CHAT_COMPLETION_SOURCES);
    expect(catalog.find((entry) => entry.source === 'nanogpt')).toMatchObject({
      hasSecret: true,
      secretKey: 'api_key_nanogpt',
    });
    expect(JSON.stringify(catalog)).not.toContain('raw-nanogpt-secret');
  });

  it('returns static models without a key or fetch', async () => {
    const service = new ProviderService(
      store(),
      new ProviderHttpClient(async () => Promise.reject(new Error('fetch must not run'))),
    );
    const models = await service.listModels({ source: 'claude' });
    expect(models.length).toBeGreaterThan(0);
  });

  it('executes and parses live model plans with the active key', async () => {
    const secrets = store();
    secrets.add('api_key_nanogpt', 'raw-key', 'Primary');
    let authorization = '';
    const service = new ProviderService(
      secrets,
      new ProviderHttpClient(async (_url, init) => {
        authorization = String((init?.headers as Record<string, string>).authorization);
        return new Response(JSON.stringify({ data: [{ id: 'model-a' }] }));
      }),
    );
    await expect(service.listModels({ source: 'nanogpt' })).resolves.toEqual([{ id: 'model-a' }]);
    expect(authorization).toBe('Bearer raw-key');
  });

  it('requires keys for connection tests but permits optional-key providers', async () => {
    const required = new ProviderService(
      store(),
      new ProviderHttpClient(async () => Promise.resolve(new Response('{}'))),
    );
    await expect(
      required.testConnection({ source: 'claude', model: 'claude-sonnet-4-20250514' }),
    ).rejects.toBeInstanceOf(ConfigurationError);

    const optional = new ProviderService(
      store(),
      new ProviderHttpClient(async () =>
        Promise.resolve(new Response(JSON.stringify({ data: [{ id: 'local' }] }))),
      ),
    );
    await expect(
      optional.testConnection({
        source: 'custom',
        model: 'local',
        baseUrl: 'http://localhost:8080',
      }),
    ).resolves.toEqual({ ok: true, detail: 'Model endpoint reachable' });
  });

  it('tests static providers with a minimal completion', async () => {
    const secrets = store();
    secrets.add('api_key_claude', 'claude-key', 'Primary');
    const service = new ProviderService(
      secrets,
      new ProviderHttpClient(async () =>
        Promise.resolve(new Response(JSON.stringify({ content: [{ text: 'OK' }] }))),
      ),
    );
    await expect(
      service.testConnection({ source: 'claude', model: 'claude-sonnet-4-20250514' }),
    ).resolves.toEqual({ ok: true, detail: 'Completion endpoint reachable' });
  });

  it('performs a normalized non-streaming completion for internal model tasks', async () => {
    const secrets = store();
    secrets.add('api_key_nanogpt', 'classification-key', 'Primary');
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: '{"suggestions":[]}' } }] })),
      );
    const service = new ProviderService(secrets, new ProviderHttpClient(fetchImpl));
    const signal = new AbortController().signal;

    await expect(
      service.completeChat(
        { source: 'nanogpt', model: 'gpt-4o-mini' },
        [{ role: 'user', content: 'Classify this source.' }],
        { temperature: 0, maxTokens: 512 },
        signal,
      ),
    ).resolves.toBe('{"suggestions":[]}');

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('/chat/completions'),
      expect.objectContaining({
        body: expect.stringContaining('"stream":false'),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('pins Google internal completions to the minimum reasoning effort', async () => {
    const secrets = store();
    secrets.add('api_key_makersuite', 'google-key', 'Primary');
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: '{"suggestions":[]}' }] } }],
        }),
      ),
    );
    const service = new ProviderService(secrets, new ProviderHttpClient(fetchImpl));

    await expect(
      service.completeChat(
        { source: 'makersuite', model: 'gemini-2.5-flash' },
        [{ role: 'user', content: 'Classify this source.' }],
        { temperature: 0, maxTokens: 512 },
      ),
    ).resolves.toBe('{"suggestions":[]}');

    // Without an explicit effort the Google builder falls back to 'auto'
    // (thinkingBudget -1: dynamic thinking); 'min' turns it off entirely.
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ body: expect.stringContaining('"thinkingBudget":0') }),
    );
  });

  it('builds generation requests using the active key', () => {
    const secrets = store();
    secrets.add('api_key_nanogpt', 'generation-key', 'Primary');
    const service = new ProviderService(
      secrets,
      new ProviderHttpClient(async () => Promise.reject(new Error('not called'))),
    );
    expect(
      service.createChatRequest(
        { source: 'nanogpt', model: 'gpt-4o-mini' },
        [{ role: 'user', content: 'Hello' }],
        { temperature: 0.65, topP: null, maxTokens: null, assistantPrefill: null },
      ),
    ).toMatchObject({
      headers: { Authorization: 'Bearer generation-key' },
      body: { stream: true, temperature: 0.65 },
    });
  });

  it('passes nullable controls only when set and preserves provider prefill behavior', () => {
    const secrets = store();
    secrets.add('api_key_claude', 'claude-key', 'Primary');
    const service = new ProviderService(
      secrets,
      new ProviderHttpClient(async () => Promise.reject(new Error('not called'))),
    );

    const withoutNullable = service.createChatRequest(
      { source: 'claude', model: 'claude-3-5-sonnet-20241022' },
      [{ role: 'user', content: 'Hello' }],
      { temperature: 0.4, topP: null, maxTokens: null, assistantPrefill: null },
    );
    expect(withoutNullable.body).toMatchObject({ temperature: 0.4 });
    expect(withoutNullable.body).not.toHaveProperty('top_p');
    expect(withoutNullable.body).not.toHaveProperty('max_tokens');
    expect(withoutNullable.body.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
    ]);

    const withControls = service.createChatRequest(
      { source: 'claude', model: 'claude-3-5-sonnet-20241022' },
      [{ role: 'user', content: 'Hello' }],
      { temperature: 0.4, topP: 0.85, maxTokens: 321, assistantPrefill: 'Answer: ' },
    );
    expect(withControls.body).toMatchObject({ temperature: 0.4, top_p: 0.85, max_tokens: 321 });
    expect(withControls.body.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Answer:' }] },
    ]);
  });

  it('requests reasoning only when the thinking control is enabled', () => {
    const secrets = store();
    secrets.add('api_key_openrouter', 'openrouter-key', 'Primary');
    const service = new ProviderService(
      secrets,
      new ProviderHttpClient(async () => Promise.reject(new Error('not called'))),
    );
    const base = { temperature: 0.5, topP: null, maxTokens: null, assistantPrefill: null };

    const off = service.createChatRequest(
      { source: 'openrouter', model: 'anthropic/claude-3.5-sonnet' },
      [{ role: 'user', content: 'Hello' }],
      { ...base, thinking: false },
    );
    expect(off.body.reasoning).toMatchObject({ exclude: true });

    const on = service.createChatRequest(
      { source: 'openrouter', model: 'anthropic/claude-3.5-sonnet' },
      [{ role: 'user', content: 'Hello' }],
      { ...base, thinking: true },
    );
    expect(on.body.reasoning).toMatchObject({ exclude: false });
  });

  it('snapshots only the JSON request body and redacts active secrets inside nested strings', () => {
    const secrets = store();
    secrets.add('api_key_custom', 'active-secret', 'Primary');
    secrets.add('api_key_openai', 'other-secret', 'Primary');
    const service = new ProviderService(
      secrets,
      new ProviderHttpClient(async () => Promise.reject(new Error('not called'))),
    );
    const request = {
      url: 'https://active-secret.example/v1',
      method: 'POST' as const,
      headers: { Authorization: 'Bearer active-secret' },
      body: {
        plain: 'safe',
        nested: { value: 'prefix active-secret and other-secret suffix', omitted: undefined },
        list: ['active-secret', { again: 'xactive-secrety' }],
      },
    };

    expect(service.snapshotRequestBody(request)).toEqual({
      plain: 'safe',
      nested: { value: 'prefix [redacted] and [redacted] suffix' },
      list: ['[redacted]', { again: 'x[redacted]y' }],
    });
    expect(JSON.stringify(service.snapshotRequestBody(request))).not.toContain('Authorization');
    expect(JSON.stringify(service.snapshotRequestBody(request))).not.toContain('https://');
  });

  it('fully redacts overlapping active secret values', () => {
    const secrets = store();
    secrets.add('api_key_custom', 'shared', 'Short');
    secrets.add('api_key_openai', 'shared-secret', 'Long');
    const service = new ProviderService(
      secrets,
      new ProviderHttpClient(async () => Promise.reject(new Error('not called'))),
    );

    expect(
      service.snapshotRequestBody({
        url: 'https://example.test',
        method: 'POST',
        headers: {},
        body: { value: 'shared-secret' },
      }),
    ).toEqual({ value: '[redacted]' });
  });
});
