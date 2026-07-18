import { describe, expect, it } from 'vitest';

import {
  chatDetailSchema,
  connectionTestResponseSchema,
  createChatSchema,
  createMessageSchema,
  encodeSseEvent,
  messageSchema,
  modelListResponseSchema,
  patchChatSchema,
  presetGenerationContextSchema,
  providerCatalogEntrySchema,
  providerConfigSchema,
  providerConnectionSchema,
  streamEventSchema,
} from './index.js';

const CHAT_ID = '62455a02-2fe1-4b6d-a6ce-4517bf06ada7';
const NOTEBOOK_ID = 'a0c7607c-b365-438b-a7e6-31b2308464b6';
const SOURCE_ID = 'f9942d0a-eaca-41a8-a3d8-87987cc173fd';
const MESSAGE_ID = '36fd9cb0-d787-483a-ab07-d09900892842';
const PRESET_ID = '73a30f4e-d17c-468c-9e73-a0f9a59732a5';
const NOW = '2026-07-10T12:00:00.000Z';

describe('Phase 6 shared schemas', () => {
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

  it('defaults chat creation and rejects duplicate sources or empty patches', () => {
    expect(createChatSchema.parse({})).toEqual({
      title: 'New chat',
      sourceIds: [],
      skillIds: [],
      presetId: null,
    });
    expect(() => createChatSchema.parse({ sourceIds: [SOURCE_ID, SOURCE_ID] })).toThrow();
    expect(() => patchChatSchema.parse({})).toThrow();
    expect(createChatSchema.parse({ presetId: PRESET_ID })).toMatchObject({ presetId: PRESET_ID });
    expect(patchChatSchema.parse({ presetId: null })).toEqual({ presetId: null });
  });

  it('preserves legacy contexts and validates strict versioned preset snapshots', () => {
    const legacy = {
      sourceIds: [SOURCE_ID],
      provider: 'nanogpt',
      model: 'gpt-4o-mini',
      strictness: 'grounded',
    };
    expect(messageSchema.shape.context.unwrap().parse(legacy)).toEqual(legacy);

    const context = {
      contextVersion: 2,
      preset: {
        id: PRESET_ID,
        schemaVersion: 1,
        name: 'Grounded development',
        generation: {
          temperature: 0.7,
          topP: null,
          maxTokens: null,
          assistantPrefill: null,
        },
        modules: [
          {
            key: 'sources',
            name: 'Selected sources',
            kind: 'sources',
            role: 'system',
            content: null,
            enabled: true,
            insertion: { position: 'before_history' },
          },
        ],
        createdAt: NOW,
        updatedAt: NOW,
      },
      canonicalMessages: [
        { role: 'system', content: '# Lore\nAmber is a city.' },
        { role: 'user', content: 'Describe Amber.' },
        { role: 'assistant', content: 'Amber glows.' },
      ],
      sources: [
        {
          id: SOURCE_ID,
          title: 'Lore',
          contentHash: 'a'.repeat(64),
          content: '# Lore\nAmber is a city.',
        },
      ],
      requestedControls: {
        temperature: 0.7,
        topP: null,
        maxTokens: null,
        assistantPrefill: null,
      },
      effectiveRequestBody: {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Describe Amber.' }],
        temperature: 0.7,
      },
      provider: 'nanogpt',
      model: 'gpt-4o-mini',
    };
    expect(presetGenerationContextSchema.parse(context)).toEqual(context);
    expect(messageSchema.shape.context.unwrap().parse(context)).toEqual(context);
    expect(() => presetGenerationContextSchema.parse({ ...context, extra: true })).toThrow();
    expect(() =>
      presetGenerationContextSchema.parse({
        ...context,
        canonicalMessages: [{ role: 'tool', content: 'nope' }],
      }),
    ).toThrow();
  });

  it('validates chat detail and generation context', () => {
    const assistant = {
      id: MESSAGE_ID,
      chatId: CHAT_ID,
      seq: 1,
      role: 'assistant',
      content: 'Amber',
      reasoning: null,
      status: 'complete',
      context: {
        sourceIds: [SOURCE_ID],
        provider: 'nanogpt',
        model: 'gpt-4o-mini',
        strictness: 'grounded',
      },
      createdAt: NOW,
    };
    expect(messageSchema.parse(assistant)).toEqual(assistant);
    expect(
      chatDetailSchema.parse({
        id: CHAT_ID,
        notebookId: NOTEBOOK_ID,
        title: 'Continuity',
        sourceIds: [SOURCE_ID],
        skillIds: [],
        presetId: null,
        createdAt: NOW,
        updatedAt: NOW,
        messages: [assistant],
      }).messages,
    ).toEqual([assistant]);
  });

  it('trims message input and rejects empty content', () => {
    expect(createMessageSchema.parse({ content: '  Explain this  ' })).toEqual({
      content: 'Explain this',
    });
    expect(() => createMessageSchema.parse({ content: '   ' })).toThrow();
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

  it('encodes one-line discriminated application SSE events', () => {
    const event = streamEventSchema.parse({ type: 'delta', text: 'line one\nline two' });
    expect(encodeSseEvent(event)).toBe(
      'event: delta\ndata: {"type":"delta","text":"line one\\nline two"}\n\n',
    );
  });
});
