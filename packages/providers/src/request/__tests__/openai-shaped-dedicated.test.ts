import { describe, expect, it } from 'vitest';

import { ProviderError, type ChatCompletionSource, type GenerationParams } from '../../types.js';
import { buildChatRequest } from '../build-request.js';

const params: GenerationParams = {
  model: 'test-model',
  messages: [{ role: 'user', content: 'Describe the brass moon.' }],
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
  reasoningEffort: 'high',
  includeReasoning: true,
};

interface Fixture {
  source: ChatCompletionSource;
  label: string;
  url: string;
  headers?: Record<string, string>;
  body: Record<string, unknown>;
  extra?: Record<string, unknown>;
}

const commonBody = {
  messages: [{ role: 'user', content: 'Describe the brass moon.' }],
  model: 'test-model',
  temperature: 0.7,
  max_tokens: 128,
  stream: true,
  presence_penalty: 0.2,
  frequency_penalty: 0.1,
  top_p: 0.9,
  seed: 7,
};

const fixtures: Fixture[] = [
  {
    source: 'deepseek',
    label: 'DeepSeek',
    url: 'https://api.deepseek.com/beta/chat/completions',
    body: {
      ...commonBody,
      stop: ['END'],
      thinking: { type: 'enabled' },
      reasoning_effort: 'high',
    },
  },
  {
    source: 'xai',
    label: 'xAI (Grok)',
    url: 'https://api.x.ai/v1/chat/completions',
    body: { ...commonBody, stop: ['END'], reasoning_effort: 'high' },
  },
  {
    source: 'aimlapi',
    label: 'AI/ML API',
    url: 'https://api.aimlapi.com/v1/chat/completions',
    headers: {
      'HTTP-Referer': 'https://github.com/dkylepeppers-alt/worldbookllm',
      'X-Title': 'worldbookllm',
    },
    body: { ...commonBody, stop: ['END'], reasoning_effort: 'high' },
  },
  {
    source: 'electronhub',
    label: 'Electron Hub',
    url: 'https://api.electronhub.ai/v1/chat/completions',
    body: { ...commonBody, top_k: 40, reasoning_effort: 'high' },
  },
  {
    source: 'chutes',
    label: 'Chutes',
    url: 'https://llm.chutes.ai/v1/chat/completions',
    extra: { repetitionPenalty: 1.1, minP: 0.05, logitBias: { '42': -1 } },
    body: {
      ...commonBody,
      top_k: 40,
      stop: ['END'],
      reasoning_effort: 'high',
      repetition_penalty: 1.1,
      min_p: 0.05,
      logit_bias: { '42': -1 },
    },
  },
];

describe('OpenAI-shaped dedicated request builders', () => {
  it.each(fixtures)(
    'builds the pinned $source request',
    ({ source, url, headers, body, extra }) => {
      expect(buildChatRequest(source, { ...params, extra })).toEqual({
        url,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-key',
          ...headers,
        },
        body,
      });
    },
  );

  it.each(fixtures)('requires an API key for $source', ({ source, label }) => {
    expect(() => buildChatRequest(source, { ...params, apiKey: undefined })).toThrow(
      new ProviderError(`${label} requires an API key.`, source),
    );
  });

  it.each([
    ['xai', 'low'],
    ['aimlapi', 'auto'],
    ['electronhub', 'auto'],
    ['chutes', 'auto'],
  ] as const)('preserves pinned auto reasoning behavior for %s', (source, expected) => {
    const request = buildChatRequest(source, {
      ...params,
      reasoningEffort: 'auto',
      extra: source === 'chutes' ? {} : undefined,
    });
    expect(request.body.reasoning_effort).toBe(expected);
  });
});
