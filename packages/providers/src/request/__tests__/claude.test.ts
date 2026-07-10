import { describe, expect, it } from 'vitest';

import { ProviderError, type GenerationParams } from '../../types.js';
import { buildChatRequest } from '../build-request.js';

const baseParams: GenerationParams = {
  model: 'claude-3-5-sonnet-20241022',
  messages: [
    { role: 'system', content: 'Use the supplied canon.' },
    { role: 'user', content: 'Describe the brass moon.' },
  ],
  stream: true,
  apiKey: 'test-key',
  maxTokens: 4096,
  temperature: 0.7,
  topP: 0.9,
  topK: 40,
  stop: ['END'],
};

describe('Claude request building', () => {
  it('builds the pinned Messages API request', () => {
    expect(buildChatRequest('claude', baseParams)).toEqual({
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'output-128k-2025-02-19,context-1m-2025-08-07',
        'x-api-key': 'test-key',
      },
      body: {
        system: [{ type: 'text', text: 'Use the supplied canon.' }],
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Describe the brass moon.' }] }],
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 4096,
        stop_sequences: ['END'],
        temperature: 0.7,
        top_p: 0.9,
        top_k: 40,
        stream: true,
      },
    });
  });

  it('ports traditional thinking and removes incompatible sampling controls', () => {
    const request = buildChatRequest('claude', {
      ...baseParams,
      model: 'claude-3-7-sonnet-20250219',
      reasoningEffort: 'low',
      assistantPrefill: 'Answer: ',
    });

    expect(request.body).toMatchObject({
      max_tokens: 4096,
      thinking: { type: 'enabled', budget_tokens: 1024 },
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'Describe the brass moon.' }] },
        { role: 'user', content: [{ type: 'text', text: 'Answer:' }] },
      ],
    });
    expect(request.body).not.toHaveProperty('temperature');
    expect(request.body).not.toHaveProperty('top_p');
    expect(request.body).not.toHaveProperty('top_k');
  });

  it('requires an API key', () => {
    expect(() => buildChatRequest('claude', { ...baseParams, apiKey: undefined })).toThrow(
      new ProviderError('Anthropic Claude requires an API key.', 'claude'),
    );
  });
});
