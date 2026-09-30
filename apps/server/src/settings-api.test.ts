import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_AGENT_GENERATION } from '@worldbookllm/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';

let app: FastifyInstance;
let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'worldbookllm-settings-'));
  app = buildApp({ dataDir, logger: false });
});

afterEach(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('settings API', () => {
  it('reads and updates app settings with a strict, partial body', async () => {
    const initial = await app.inject({ method: 'GET', url: '/api/app-settings' });
    expect(initial.json()).toEqual({
      providerConfig: null,
      agentReviewMode: false,
      // Seeded from the old default preset: temperature 0.7, no other limits.
      agentGeneration: { ...DEFAULT_AGENT_GENERATION, temperature: 0.7 },
    });

    const provider = await app.inject({
      method: 'PATCH',
      url: '/api/app-settings',
      payload: { providerConfig: { source: 'nanogpt', model: 'gpt-4o-mini' } },
    });
    expect(provider.json()).toMatchObject({
      providerConfig: { source: 'nanogpt', model: 'gpt-4o-mini' },
    });

    const generation = { temperature: 0.4, topP: 0.9, maxTokens: 4096, thinking: true };
    const updated = await app.inject({
      method: 'PATCH',
      url: '/api/app-settings',
      payload: { agentGeneration: generation, agentReviewMode: true },
    });
    expect(updated.json()).toEqual({
      providerConfig: { source: 'nanogpt', model: 'gpt-4o-mini' },
      agentReviewMode: true,
      agentGeneration: generation,
    });

    for (const payload of [
      {},
      { defaultPresetId: '00000000-0000-4000-8000-000000000000' },
      { agentGeneration: { ...generation, assistantPrefill: 'Sure' } },
    ]) {
      const invalid = await app.inject({ method: 'PATCH', url: '/api/app-settings', payload });
      expect(invalid.statusCode).toBe(400);
    }
  });
});
