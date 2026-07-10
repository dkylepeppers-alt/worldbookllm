import { describe, expect, it } from 'vitest';

import {
  apiErrorSchema,
  createNotebookSchema,
  createSecretSchema,
  createSourceSchema,
  notebookListSchema,
  patchNotebookSchema,
  providerConfigSchema,
  providerSourceSchema,
  secretStateSchema,
  sourceDetailSchema,
  sourceMetadataListSchema,
} from './index.js';

describe('data API schemas', () => {
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
    });
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
      origin: 'paste',
      wordCount: 2,
      contentHash: 'a'.repeat(64),
      createdAt: '2026-07-10T12:00:00.000Z',
      updatedAt: '2026-07-10T12:00:00.000Z',
      content: '# Lore',
    };
    expect(sourceDetailSchema.parse(detail)).toEqual(detail);
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
      origin: 'paste',
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
