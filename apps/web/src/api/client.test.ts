import type {
  AppSettings,
  Chat,
  MaskedSecret,
  Message,
  Notebook,
  PortablePreset,
  Preset,
  ProviderCatalogEntry,
  SourceDetail,
  SourceMetadata,
} from '@worldbookllm/shared';
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
  origin: { type: 'paste' },
  conversionNotes: [],
  category: null,
  tags: [],
  wordCount: 4,
  contentHash: 'a'.repeat(64),
  createdAt: '2026-07-10T12:00:00.000Z',
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

const chat: Chat = {
  id: '60a0bf0c-031d-497c-9c1a-2f68441936a6',
  notebookId: notebook.id,
  title: 'New chat',
  sourceIds: [],
  skillIds: [],
  providerOverride: null,
  presetId: null,
  createdAt: '2026-07-10T12:00:00.000Z',
  updatedAt: '2026-07-10T12:00:00.000Z',
};

const portablePreset: PortablePreset = {
  schemaVersion: 1,
  name: 'Story architect',
  generation: { temperature: 0.8, topP: 0.9, maxTokens: 4096, assistantPrefill: null },
  modules: [
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

const preset: Preset = {
  id: '71b57732-b2f5-49ef-9829-f0155e8f821f',
  ...portablePreset,
  createdAt: '2026-07-10T12:00:00.000Z',
  updatedAt: '2026-07-10T12:00:00.000Z',
};

const appSettings: AppSettings = { defaultPresetId: preset.id };

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

  it('edits a source and selects a message variant with PATCH', async () => {
    const edited: SourceDetail = { ...source, title: 'Renamed', content: 'New body' };
    const message: Message = {
      id: '3fdd7a3e-6d4e-4a56-a2a4-8b8a29f6d0cf',
      chatId: chat.id,
      seq: 1,
      role: 'assistant',
      content: 'First',
      reasoning: null,
      status: 'complete',
      context: null,
      createdAt: '2026-07-10T12:01:05.000Z',
      activeVariant: 0,
      variants: [
        {
          content: 'First',
          reasoning: null,
          status: 'complete',
          context: null,
          createdAt: '2026-07-10T12:01:05.000Z',
        },
        {
          content: 'Second',
          reasoning: null,
          status: 'complete',
          context: null,
          createdAt: '2026-07-10T12:02:05.000Z',
        },
      ],
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(edited))
      .mockResolvedValueOnce(jsonResponse(message));
    const client = createApiClient(fetchImpl);

    await expect(
      client.updateSource(source.id, { title: 'Renamed', content: 'New body' }),
    ).resolves.toEqual(edited);
    await expect(client.selectVariant(message.id, 0)).resolves.toEqual(message);

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      `/api/sources/${source.id}`,
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ title: 'Renamed', content: 'New body' }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      `/api/messages/${message.id}`,
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ activeVariant: 0 }) }),
    );
  });

  it('uploads file previews as multipart and saves reviewed sources in a batch', async () => {
    const preview = {
      format: 'lorebook' as const,
      origin: { type: 'file' as const, fileName: 'atlas.json', mediaType: 'application/json' },
      entries: [{ title: 'Lore', markdown: 'Lore body.' }],
      conversionNotes: ['Activation metadata omitted.'],
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(preview))
      .mockResolvedValueOnce(jsonResponse([source], { status: 201 }));
    const client = createApiClient(fetchImpl);
    const file = new File(['{"entries":{}}'], 'atlas.json', { type: 'application/json' });

    await expect(client.previewFileImport(notebook.id, file)).resolves.toEqual(preview);
    await expect(
      client.createSources(notebook.id, [{ title: 'Lore', content: 'Lore body.' }]),
    ).resolves.toEqual([source]);

    const uploadInit = fetchImpl.mock.calls[0]?.[1];
    expect(uploadInit?.headers).toEqual({ Accept: 'application/json' });
    expect(uploadInit?.body).toBeInstanceOf(FormData);
    expect((uploadInit?.body as FormData).get('file')).toBe(file);
    expect(fetchImpl.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify([{ title: 'Lore', content: 'Lore body.' }]),
      }),
    );
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

  it('covers every chat operation', async () => {
    const detail = { ...chat, messages: [] };
    const renamed = { ...chat, title: 'Renamed chat' };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse([chat]))
      .mockResolvedValueOnce(jsonResponse(chat, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse(detail))
      .mockResolvedValueOnce(jsonResponse(renamed))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = createApiClient(fetchImpl);

    await expect(client.listChats(notebook.id)).resolves.toEqual([chat]);
    await expect(client.createChat(notebook.id, {})).resolves.toEqual(chat);
    await expect(client.getChat(chat.id)).resolves.toEqual(detail);
    await expect(client.updateChat(chat.id, { title: renamed.title })).resolves.toEqual(renamed);
    await expect(client.deleteChat(chat.id)).resolves.toBeUndefined();

    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      `/api/notebooks/${notebook.id}/chats`,
      `/api/notebooks/${notebook.id}/chats`,
      `/api/chats/${chat.id}`,
      `/api/chats/${chat.id}`,
      `/api/chats/${chat.id}`,
    ]);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      4,
      `/api/chats/${chat.id}`,
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ title: renamed.title }) }),
    );
  });

  it('covers every preset and app-settings operation', async () => {
    const revised = { ...preset, name: 'Revised architect' };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse([preset]))
      .mockResolvedValueOnce(jsonResponse(preset, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse(preset))
      .mockResolvedValueOnce(jsonResponse(revised))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse(appSettings))
      .mockResolvedValueOnce(jsonResponse(appSettings));
    const client = createApiClient(fetchImpl);

    await expect(client.listPresets()).resolves.toEqual([preset]);
    await expect(client.createPreset(portablePreset)).resolves.toEqual(preset);
    await expect(client.getPreset(preset.id)).resolves.toEqual(preset);
    await expect(client.updatePreset(preset.id, { name: revised.name })).resolves.toEqual(revised);
    await expect(client.deletePreset(preset.id)).resolves.toBeUndefined();
    await expect(client.getAppSettings()).resolves.toEqual(appSettings);
    await expect(client.updateAppSettings(appSettings)).resolves.toEqual(appSettings);

    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      '/api/presets',
      '/api/presets',
      `/api/presets/${preset.id}`,
      `/api/presets/${preset.id}`,
      `/api/presets/${preset.id}`,
      '/api/app-settings',
      '/api/app-settings',
    ]);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      '/api/presets',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(portablePreset) }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      4,
      `/api/presets/${preset.id}`,
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ name: revised.name }) }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      5,
      `/api/presets/${preset.id}`,
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      7,
      '/api/app-settings',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify(appSettings) }),
    );
  });

  it('validates preset responses and preserves preset API errors', async () => {
    const invalidFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse([{ ...preset, id: 1 }]));
    await expect(createApiClient(invalidFetch).listPresets()).rejects.toMatchObject({
      status: 200,
      code: 'invalid_response',
    });

    const errorFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse(
          { error: 'default_preset', message: 'The default preset cannot be deleted' },
          { status: 409 },
        ),
      );
    await expect(createApiClient(errorFetch).deletePreset(preset.id)).rejects.toMatchObject({
      status: 409,
      code: 'default_preset',
      message: 'The default preset cannot be deleted',
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
