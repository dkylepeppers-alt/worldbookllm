import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CHAT_COMPLETION_SOURCES } from '@worldbookllm/providers';
import { afterEach, describe, expect, it } from 'vitest';

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

  it('builds generation requests using the active key', () => {
    const secrets = store();
    secrets.add('api_key_nanogpt', 'generation-key', 'Primary');
    const service = new ProviderService(
      secrets,
      new ProviderHttpClient(async () => Promise.reject(new Error('not called'))),
    );
    expect(
      service.createChatRequest({ source: 'nanogpt', model: 'gpt-4o-mini' }, [
        { role: 'user', content: 'Hello' },
      ]),
    ).toMatchObject({
      headers: { Authorization: 'Bearer generation-key' },
      body: { stream: true },
    });
  });
});
