import { describe, expect, it } from 'vitest';

import { ProviderError, type GenerationParams } from '../../types.js';
import { buildChatRequest } from '../build-request.js';

const params: GenerationParams = {
  model: 'test-model',
  messages: [
    { role: 'system', content: 'Use the supplied canon.' },
    { role: 'user', content: 'Describe the brass moon.' },
  ],
  stream: true,
  apiKey: 'test-key',
  maxTokens: 128,
  temperature: 0.7,
  topP: 0.9,
  topK: 40,
  frequencyPenalty: 0.1,
  presencePenalty: 0.2,
  stop: ['END'],
  seed: 7,
};

describe('standard dedicated request builders', () => {
  it('builds the pinned AI21 request', () => {
    expect(buildChatRequest('ai21', params)).toEqual({
      url: 'https://api.ai21.com/studio/v1/chat/completions',
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        Authorization: 'Bearer test-key',
      },
      body: {
        messages: [
          { role: 'system', content: 'Use the supplied canon.' },
          { role: 'user', content: 'Describe the brass moon.' },
        ],
        model: 'test-model',
        max_tokens: 128,
        temperature: 0.7,
        top_p: 0.9,
        stop: ['END'],
        stream: true,
      },
    });
  });

  it('builds the pinned Mistral request', () => {
    expect(buildChatRequest('mistralai', { ...params, extra: { safePrompt: true } })).toEqual({
      url: 'https://api.mistral.ai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-key',
      },
      body: {
        model: 'test-model',
        messages: [
          { role: 'system', content: 'Use the supplied canon.' },
          { role: 'user', content: 'Describe the brass moon.' },
        ],
        temperature: 0.7,
        top_p: 0.9,
        frequency_penalty: 0.1,
        presence_penalty: 0.2,
        max_tokens: 128,
        stream: true,
        safe_prompt: true,
        random_seed: 7,
        stop: ['END'],
      },
    });
  });

  it('builds the pinned Cohere v2 request', () => {
    expect(buildChatRequest('cohere', { ...params, model: 'command-r-plus-08-2024' })).toEqual({
      url: 'https://api.cohere.ai/v2/chat',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-key',
      },
      body: {
        stream: true,
        model: 'command-r-plus-08-2024',
        messages: [
          { role: 'system', content: 'Use the supplied canon.' },
          { role: 'user', content: 'Describe the brass moon.' },
        ],
        temperature: 0.7,
        max_tokens: 128,
        k: 40,
        p: 0.9,
        seed: 7,
        stop_sequences: ['END'],
        frequency_penalty: 0.1,
        presence_penalty: 0.2,
        documents: [],
        tools: [],
        safety_mode: 'OFF',
      },
    });
  });

  it.each([
    ['ai21', 'AI21'],
    ['mistralai', 'Mistral AI'],
    ['cohere', 'Cohere'],
  ] as const)('requires an API key for %s', (source, label) => {
    expect(() => buildChatRequest(source, { ...params, apiKey: undefined })).toThrow(
      new ProviderError(`${label} requires an API key.`, source),
    );
  });
});
