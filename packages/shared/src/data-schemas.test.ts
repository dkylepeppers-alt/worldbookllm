import { describe, expect, it } from 'vitest';

import {
  apiErrorSchema,
  connectionTestResponseSchema,
  createSecretSchema,
  modelListResponseSchema,
  providerCatalogEntrySchema,
  providerConfigSchema,
  providerConnectionSchema,
  providerSourceSchema,
  secretStateSchema,
  sourceOriginSchema,
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

  it('validates stable API errors', () => {
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

  it('separates provider connection fields from complete config', () => {
    expect(providerConnectionSchema.parse({ source: 'nanogpt' })).toEqual({
      source: 'nanogpt',
    });
    expect(
      providerConfigSchema.parse({
        source: 'custom',
        model: 'local',
        baseUrl: 'http://localhost:8080',
      }),
    ).toEqual({ source: 'custom', model: 'local', baseUrl: 'http://localhost:8080' });
    expect(() => providerConnectionSchema.parse({ source: 'nanogpt', model: 'nope' })).toThrow();
  });

  it('validates provider catalog and operation responses', () => {
    expect(
      providerCatalogEntrySchema.parse({
        source: 'workers_ai',
        label: 'Cloudflare Workers AI',
        family: 'openai-compat',
        secretKey: 'api_key_workers_ai',
        modelSource: 'live',
        extraFields: [{ key: 'accountId', label: 'Account ID', required: true }],
        hasSecret: false,
      }),
    ).toBeTruthy();
    expect(modelListResponseSchema.parse({ models: [{ id: 'model', vendorField: 42 }] })).toEqual({
      models: [{ id: 'model', vendorField: 42 }],
    });
    expect(connectionTestResponseSchema.parse({ ok: true, detail: 'reachable' })).toEqual({
      ok: true,
      detail: 'reachable',
    });
  });
});
