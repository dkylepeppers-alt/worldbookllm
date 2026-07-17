import { describe, expect, it } from 'vitest';

import {
  coalesceCanonicalMessages,
  apiErrorSchema,
  createNotebookSchema,
  createSecretSchema,
  createSourceSchema,
  notebookListSchema,
  patchNotebookSchema,
  patchSourceSchema,
  patchMessageSchema,
  providerConfigSchema,
  providerSourceSchema,
  secretStateSchema,
  sourceDetailSchema,
  sourceMetadataListSchema,
  sourceOriginSchema,
} from './index.js';

describe('data API schemas', () => {
  it('coalesces only adjacent canonical messages with the same role without mutating input', () => {
    const input = [
      { role: 'system' as const, content: 'System one' },
      { role: 'system' as const, content: 'System two' },
      { role: 'user' as const, content: 'User one' },
      { role: 'assistant' as const, content: 'Assistant one' },
      { role: 'assistant' as const, content: 'Assistant two' },
      { role: 'system' as const, content: 'System three' },
    ];

    expect(coalesceCanonicalMessages(input)).toEqual([
      { role: 'system', content: 'System one\n\nSystem two' },
      { role: 'user', content: 'User one' },
      { role: 'assistant', content: 'Assistant one\n\nAssistant two' },
      { role: 'system', content: 'System three' },
    ]);
    expect(input[0]?.content).toBe('System one');
  });

  it('pins every M1 provider source', () => {
    expect(providerSourceSchema.options).toEqual([
      'openai',
      'claude',
      'openrouter',
      'ai21',
      'makersuite',
      'vertexai',
      'mistralai',
      'custom',
      'cohere',
      'perplexity',
      'groq',
      'chutes',
      'electronhub',
      'nanogpt',
      'deepseek',
      'aimlapi',
      'xai',
      'pollinations',
      'moonshot',
      'fireworks',
      'cometapi',
      'azure_openai',
      'zai',
      'siliconflow',
      'minimax',
      'workers_ai',
    ]);
  });

  it('validates provider settings without accepting unknown fields', () => {
    expect(
      providerConfigSchema.parse({
        source: 'nanogpt',
        model: 'meta/llama',
        baseUrl: 'https://example.com/v1',
        extra: { region: 'us-central1' },
      }),
    ).toEqual({
      source: 'nanogpt',
      model: 'meta/llama',
      baseUrl: 'https://example.com/v1',
      extra: { region: 'us-central1' },
    });
    expect(() =>
      providerConfigSchema.parse({ source: 'nanogpt', model: 'x', apiKey: 'secret' }),
    ).toThrow();
  });

  it('trims notebook input and rejects empty patches', () => {
    expect(createNotebookSchema.parse({ name: ' Atlas ' })).toEqual({
      name: 'Atlas',
      settings: null,
    });
    expect(() => createNotebookSchema.parse({ name: '' })).toThrow();
    expect(() => patchNotebookSchema.parse({})).toThrow();
    expect(patchNotebookSchema.parse({ settings: null })).toEqual({ settings: null });
  });

  it('validates pasted sources and source detail responses', () => {
    expect(createSourceSchema.parse({ title: ' Lore ', content: '# Lore' })).toEqual({
      title: 'Lore',
      content: '# Lore',
      origin: { type: 'paste' },
      conversionNotes: [],
      category: null,
      tags: [],
    });
    expect(
      createSourceSchema.parse({
        title: 'Lore',
        content: '# Lore',
        category: 'factions',
        tags: ['iron-compact'],
      }),
    ).toMatchObject({ category: 'factions', tags: ['iron-compact'] });
    expect(() =>
      createSourceSchema.parse({ title: 'Lore', content: '# Lore', category: 'weather' }),
    ).toThrow();
    expect(() =>
      createSourceSchema.parse({ title: 'Lore', content: 'x'.repeat(10_485_761) }),
    ).toThrow();

    const detail = {
      id: 'f9942d0a-eaca-41a8-a3d8-87987cc173fd',
      notebookId: 'a0c7607c-b365-438b-a7e6-31b2308464b6',
      title: 'Lore',
      slug: 'lore',
      filePath:
        'notebooks/a0c7607c-b365-438b-a7e6-31b2308464b6/sources/f9942d0a-eaca-41a8-a3d8-87987cc173fd-lore.md',
      origin: { type: 'paste' },
      conversionNotes: [],
      category: null,
      tags: [],
      wordCount: 2,
      contentHash: 'a'.repeat(64),
      createdAt: '2026-07-10T12:00:00.000Z',
      updatedAt: '2026-07-10T12:00:00.000Z',
      content: '# Lore',
    };
    expect(sourceDetailSchema.parse(detail)).toEqual(detail);
  });

  it('validates source edits and requires at least one field', () => {
    expect(patchSourceSchema.parse({ title: ' Renamed ' })).toEqual({ title: 'Renamed' });
    expect(patchSourceSchema.parse({ content: '# New body' })).toEqual({ content: '# New body' });
    expect(patchSourceSchema.parse({ title: 'A', content: 'B' })).toEqual({
      title: 'A',
      content: 'B',
    });
    expect(patchSourceSchema.parse({ category: 'places' })).toEqual({ category: 'places' });
    expect(patchSourceSchema.parse({ category: null })).toEqual({ category: null });
    expect(patchSourceSchema.parse({ tags: [' Iron-Compact '] })).toEqual({
      tags: ['Iron-Compact'],
    });
    expect(() => patchSourceSchema.parse({})).toThrow();
    expect(() => patchSourceSchema.parse({ title: '' })).toThrow();
    expect(() => patchSourceSchema.parse({ content: '' })).toThrow();
    expect(() => patchSourceSchema.parse({ category: 'weather' })).toThrow();
    expect(() => patchSourceSchema.parse({ tags: [''] })).toThrow();
    expect(() => patchSourceSchema.parse({ origin: { type: 'paste' } })).toThrow();
  });

  it('validates active-variant selection patches', () => {
    expect(patchMessageSchema.parse({ activeVariant: 0 })).toEqual({ activeVariant: 0 });
    expect(patchMessageSchema.parse({ activeVariant: 3 })).toEqual({ activeVariant: 3 });
    expect(() => patchMessageSchema.parse({ activeVariant: -1 })).toThrow();
    expect(() => patchMessageSchema.parse({ activeVariant: 1.5 })).toThrow();
    expect(() => patchMessageSchema.parse({})).toThrow();
  });

  it('accepts every documented source origin variant and rejects unsafe URLs', () => {
    expect(sourceOriginSchema.parse({ type: 'paste' })).toEqual({ type: 'paste' });
    expect(
      sourceOriginSchema.parse({
        type: 'file',
        fileName: 'lorebook.json',
        mediaType: 'application/json',
      }),
    ).toEqual({ type: 'file', fileName: 'lorebook.json', mediaType: 'application/json' });
    const urlOrigin = {
      type: 'url',
      url: 'https://example.com/lore',
      fetchedAt: '2026-07-14T12:00:00.000Z',
      mediaType: 'text/html',
    };
    expect(sourceOriginSchema.parse(urlOrigin)).toEqual(urlOrigin);
    expect(() => sourceOriginSchema.parse({ ...urlOrigin, url: 'javascript:alert(1)' })).toThrow();
    expect(() => sourceOriginSchema.parse({ ...urlOrigin, url: 'ftp://example.com' })).toThrow();
    const assistantOrigin = {
      type: 'assistant-response',
      chatId: '62455a02-2fe1-4b6d-a6ce-4517bf06ada7',
      messageId: '36fd9cb0-d787-483a-ab07-d09900892842',
    };
    expect(sourceOriginSchema.parse(assistantOrigin)).toEqual(assistantOrigin);
    expect(() => sourceOriginSchema.parse({ ...assistantOrigin, extra: true })).toThrow();
  });

  it('validates collection responses and stable API errors', () => {
    const notebook = {
      id: 'a0c7607c-b365-438b-a7e6-31b2308464b6',
      name: 'Atlas',
      settings: null,
      createdAt: '2026-07-10T12:00:00.000Z',
      updatedAt: '2026-07-10T12:00:00.000Z',
    };
    const source = {
      id: 'f9942d0a-eaca-41a8-a3d8-87987cc173fd',
      notebookId: notebook.id,
      title: 'Lore',
      slug: 'lore',
      filePath: `notebooks/${notebook.id}/sources/f9942d0a-eaca-41a8-a3d8-87987cc173fd-lore.md`,
      origin: { type: 'paste' },
      conversionNotes: [],
      category: null,
      tags: [],
      wordCount: 2,
      contentHash: 'a'.repeat(64),
      createdAt: '2026-07-10T12:00:00.000Z',
      updatedAt: '2026-07-10T12:00:00.000Z',
    };

    expect(notebookListSchema.parse([notebook])).toEqual([notebook]);
    expect(sourceMetadataListSchema.parse([source])).toEqual([source]);
    expect(
      apiErrorSchema.parse({
        error: 'validation_error',
        message: 'Invalid request',
        issues: [{ code: 'too_small', path: ['name'], message: 'Required' }],
      }),
    ).toEqual({
      error: 'validation_error',
      message: 'Invalid request',
      issues: [{ code: 'too_small', path: ['name'], message: 'Required' }],
    });
    expect(apiErrorSchema.parse({ error: 'not_found', message: 'Notebook not found' })).toEqual({
      error: 'not_found',
      message: 'Notebook not found',
    });
    expect(() => apiErrorSchema.parse({ error: 'not_found' })).toThrow();
  });

  it('defaults secret labels and validates masked state', () => {
    expect(createSecretSchema.parse({ key: 'api_key_openai', value: 'secret' })).toEqual({
      key: 'api_key_openai',
      value: 'secret',
      label: 'Unlabeled',
    });
    expect(
      secretStateSchema.parse({
        api_key_openai: [
          {
            id: 'f9942d0a-eaca-41a8-a3d8-87987cc173fd',
            value: '*******ret',
            label: 'Primary',
            active: true,
          },
        ],
      }),
    ).toBeTruthy();
    expect(() => createSecretSchema.parse({ key: '../bad', value: 'secret' })).toThrow();
  });
});
