import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { PortablePreset, Preset } from '@worldbookllm/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';

const newPreset: PortablePreset = {
  schemaVersion: 1,
  name: 'Story architect',
  generation: {
    temperature: 0.8,
    topP: 0.9,
    maxTokens: 4096,
    assistantPrefill: null,
  },
  modules: [
    {
      key: 'role',
      name: 'Role',
      kind: 'custom',
      role: 'system',
      content: 'Develop the setting carefully.',
      enabled: true,
      insertion: { position: 'before_history' },
    },
    {
      key: 'sources',
      name: 'Sources',
      kind: 'sources',
      role: 'system',
      content: null,
      enabled: true,
      insertion: { position: 'before_history' },
    },
  ],
};

describe('preset API', () => {
  let app: FastifyInstance;
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'worldbookllm-presets-api-'));
    app = buildApp({ dataDir, logger: false });
  });

  afterEach(async () => {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function listPresets(): Promise<Preset[]> {
    const response = await app.inject({ method: 'GET', url: '/api/presets' });
    expect(response.statusCode).toBe(200);
    return response.json<Preset[]>();
  }

  it('creates, lists, reads, patches, and deletes a preset', async () => {
    const create = await app.inject({ method: 'POST', url: '/api/presets', payload: newPreset });
    expect(create.statusCode).toBe(201);
    const preset = create.json<Preset>();
    expect(preset).toEqual({
      id: expect.any(String),
      ...newPreset,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });

    expect(await listPresets()).toEqual(expect.arrayContaining([preset]));

    const detail = await app.inject({ method: 'GET', url: `/api/presets/${preset.id}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toEqual(preset);

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/presets/${preset.id}`,
      payload: { name: 'Revised architect' },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json()).toEqual({
      ...preset,
      name: 'Revised architect',
      updatedAt: expect.any(String),
    });

    const generationPatch = await app.inject({
      method: 'PATCH',
      url: `/api/presets/${preset.id}`,
      payload: { generation: { temperature: 0.4 } },
    });
    expect(generationPatch.statusCode).toBe(200);
    expect(generationPatch.json()).toMatchObject({
      generation: { ...newPreset.generation, temperature: 0.4 },
    });

    for (const generation of [{}, { temperature: 0.4, extra: true }]) {
      const invalid = await app.inject({
        method: 'PATCH',
        url: `/api/presets/${preset.id}`,
        payload: { generation },
      });
      expect(invalid.statusCode).toBe(400);
    }

    const deletion = await app.inject({ method: 'DELETE', url: `/api/presets/${preset.id}` });
    expect(deletion.statusCode).toBe(204);
    expect((await listPresets()).some((entry) => entry.id === preset.id)).toBe(false);
  });

  it('suffixes colliding create names', async () => {
    const first = await app.inject({ method: 'POST', url: '/api/presets', payload: newPreset });
    const second = await app.inject({
      method: 'POST',
      url: '/api/presets',
      payload: { ...newPreset, name: newPreset.name.toUpperCase() },
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toMatchObject({ name: 'STORY ARCHITECT (2)' });
  });

  it('reads and updates app settings with a strict, partial body', async () => {
    const initial = await app.inject({ method: 'GET', url: '/api/app-settings' });
    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toEqual({ defaultPresetId: expect.any(String), providerConfig: null });

    const created = await app.inject({ method: 'POST', url: '/api/presets', payload: newPreset });
    const preset = created.json<Preset>();
    const update = await app.inject({
      method: 'PATCH',
      url: '/api/app-settings',
      payload: { defaultPresetId: preset.id },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json()).toEqual({ defaultPresetId: preset.id, providerConfig: null });

    const providerUpdate = await app.inject({
      method: 'PATCH',
      url: '/api/app-settings',
      payload: { providerConfig: { source: 'nanogpt', model: 'gpt-4o-mini' } },
    });
    expect(providerUpdate.statusCode).toBe(200);
    expect(providerUpdate.json()).toEqual({
      defaultPresetId: preset.id,
      providerConfig: { source: 'nanogpt', model: 'gpt-4o-mini' },
    });

    const empty = await app.inject({ method: 'PATCH', url: '/api/app-settings', payload: {} });
    expect(empty.statusCode).toBe(400);

    const invalid = await app.inject({
      method: 'PATCH',
      url: '/api/app-settings',
      payload: { defaultPresetId: preset.id, extra: true },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({
      error: 'validation_error',
      issues: [{ path: [], message: expect.any(String) }],
    });
    expect((await app.inject({ method: 'GET', url: '/api/app-settings' })).json()).toEqual({
      defaultPresetId: preset.id,
      providerConfig: { source: 'nanogpt', model: 'gpt-4o-mini' },
    });
  });

  it('returns field-level validation issues without creating data', async () => {
    const before = await listPresets();
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/presets',
      payload: { ...newPreset, name: '' },
    });

    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({
      error: 'validation_error',
      issues: [{ path: ['name'], message: expect.any(String) }],
    });
    expect(await listPresets()).toEqual(before);
  });

  it('rejects deletion of the default preset with the existing conflict response', async () => {
    const settings = (await app.inject({ method: 'GET', url: '/api/app-settings' })).json<{
      defaultPresetId: string;
    }>();
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/presets/${settings.defaultPresetId}`,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: 'default_preset',
      message: 'The default preset cannot be deleted',
    });
  });

  it('accepts inherited and explicit chat presets and rejects missing presets', async () => {
    const notebook = (
      await app.inject({ method: 'POST', url: '/api/notebooks', payload: { name: 'Atlas' } })
    ).json<{ id: string }>();
    const preset = (
      await app.inject({ method: 'POST', url: '/api/presets', payload: newPreset })
    ).json<Preset>();

    const inherited = await app.inject({
      method: 'POST',
      url: `/api/notebooks/${notebook.id}/chats`,
      payload: {},
    });
    expect(inherited.statusCode).toBe(201);
    expect(inherited.json()).toMatchObject({ presetId: null });

    const explicit = await app.inject({
      method: 'POST',
      url: `/api/notebooks/${notebook.id}/chats`,
      payload: { presetId: preset.id },
    });
    expect(explicit.statusCode).toBe(201);
    expect(explicit.json()).toMatchObject({ presetId: preset.id });

    const missingId = 'f9942d0a-eaca-41a8-a3d8-87987cc173fd';
    const missingCreate = await app.inject({
      method: 'POST',
      url: `/api/notebooks/${notebook.id}/chats`,
      payload: { presetId: missingId },
    });
    expect(missingCreate.statusCode).toBe(404);
    expect(missingCreate.json()).toEqual({
      error: 'not_found',
      message: `Preset ${missingId} was not found`,
    });

    const missingPatch = await app.inject({
      method: 'PATCH',
      url: `/api/chats/${explicit.json<{ id: string }>().id}`,
      payload: { presetId: missingId },
    });
    expect(missingPatch.statusCode).toBe(404);
  });

  it('makes explicit chats inherit after their non-default preset is deleted', async () => {
    const notebook = (
      await app.inject({ method: 'POST', url: '/api/notebooks', payload: { name: 'Atlas' } })
    ).json<{ id: string }>();
    const preset = (
      await app.inject({ method: 'POST', url: '/api/presets', payload: newPreset })
    ).json<Preset>();
    const chat = (
      await app.inject({
        method: 'POST',
        url: `/api/notebooks/${notebook.id}/chats`,
        payload: { presetId: preset.id },
      })
    ).json<{ id: string }>();

    expect(
      (await app.inject({ method: 'DELETE', url: `/api/presets/${preset.id}` })).statusCode,
    ).toBe(204);
    const detail = await app.inject({ method: 'GET', url: `/api/chats/${chat.id}` });
    expect(detail.json()).toMatchObject({ presetId: null });
  });
});
