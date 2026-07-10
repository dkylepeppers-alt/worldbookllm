import { describe, expect, it } from 'vitest';

import type { ChatCompletionSource, GenerationParams } from '../../types.js';
import { ProviderError } from '../../types.js';
import { buildChatRequest } from '../build-request.js';
import { OPENAI_COMPAT_SOURCES } from '../openai-compatible.js';

const messages = [
  { role: 'system', content: 'Use the supplied canon.' },
  { role: 'user', content: 'Describe the brass moon.' },
];

const commonParams: GenerationParams = {
  model: 'test-model',
  messages,
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

const commonBody = {
  messages,
  model: 'test-model',
  temperature: 0.7,
  max_tokens: 128,
  stream: true,
  presence_penalty: 0.2,
  frequency_penalty: 0.1,
  top_p: 0.9,
  top_k: 40,
  stop: ['END'],
  seed: 7,
};

interface RequestFixture {
  source: ChatCompletionSource;
  url: string;
  params?: Partial<GenerationParams>;
  headers?: Record<string, string>;
  providerBody?: Record<string, unknown>;
}

const fixtures: RequestFixture[] = [
  {
    source: 'openai',
    url: 'https://api.openai.com/v1/chat/completions',
  },
  {
    source: 'openrouter',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    headers: {
      'HTTP-Referer': 'https://github.com/dkylepeppers-alt/worldbookllm',
      'X-Title': 'worldbookllm',
    },
    providerBody: { reasoning: { exclude: false, effort: 'high' } },
  },
  {
    source: 'custom',
    url: 'http://localhost:8080/v1/chat/completions',
    params: { apiKey: undefined, baseUrl: 'http://localhost:8080/v1/' },
  },
  {
    source: 'perplexity',
    url: 'https://api.perplexity.ai/chat/completions',
    providerBody: { reasoning_effort: 'high' },
  },
  {
    source: 'groq',
    url: 'https://api.groq.com/openai/v1/chat/completions',
  },
  {
    source: 'nanogpt',
    url: 'https://nano-gpt.com/api/v1/chat/completions',
    providerBody: { reasoning: { effort: 'medium' } },
  },
  {
    source: 'pollinations',
    url: 'https://gen.pollinations.ai/v1/chat/completions',
    providerBody: { reasoning_effort: 'high' },
  },
  {
    source: 'moonshot',
    url: 'https://api.moonshot.ai/v1/chat/completions',
    providerBody: { thinking: { type: 'enabled' } },
  },
  {
    source: 'fireworks',
    url: 'https://api.fireworks.ai/inference/v1/chat/completions',
  },
  {
    source: 'zai',
    url: 'https://api.z.ai/api/coding/paas/v4/chat/completions',
    params: { extra: { endpoint: 'coding' } },
    headers: { 'Accept-Language': 'en-US,en' },
    providerBody: { thinking: { type: 'enabled' } },
  },
  {
    source: 'siliconflow',
    url: 'https://api.siliconflow.cn/v1/chat/completions',
    params: { extra: { region: 'cn' } },
  },
  {
    source: 'workers_ai',
    url: 'https://api.cloudflare.com/client/v4/accounts/account%2Fid/ai/v1/chat/completions',
    params: { extra: { accountId: 'account/id', repetitionPenalty: 1.1 } },
    providerBody: { repetition_penalty: 1.1 },
  },
];

describe('OpenAI-compatible request building', () => {
  it('pins the 13 shared-path sources', () => {
    expect(OPENAI_COMPAT_SOURCES).toEqual([
      'openai',
      'openrouter',
      'custom',
      'perplexity',
      'groq',
      'nanogpt',
      'pollinations',
      'moonshot',
      'fireworks',
      'cometapi',
      'zai',
      'siliconflow',
      'workers_ai',
    ]);
  });

  it.each(fixtures)(
    'builds the pinned $source request shape',
    ({ source, url, params, headers, providerBody }) => {
      const request = buildChatRequest(source, { ...commonParams, ...params });

      expect(request).toEqual({
        url,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(params?.apiKey === undefined && source === 'custom'
            ? {}
            : { Authorization: 'Bearer test-key' }),
          ...headers,
        },
        body: { ...commonBody, ...providerBody },
      });
    },
  );

  it('keeps CometAPI disabled to match the pinned SillyTavern source', () => {
    expect(() => buildChatRequest('cometapi', commonParams)).toThrow(
      new ProviderError('CometAPI is temporarily disabled.', 'cometapi'),
    );
  });

  it('uses the anonymous Pollinations endpoint without a stored key', () => {
    const request = buildChatRequest('pollinations', {
      ...commonParams,
      apiKey: undefined,
    });

    expect(request.url).toBe('https://text.pollinations.ai/v1/chat/completions');
    expect(request.headers.Authorization).toBe('Bearer anonymous');
    expect(request.body).not.toHaveProperty('reasoning_effort');
  });

  it('requires a custom base URL', () => {
    expect(() =>
      buildChatRequest('custom', { ...commonParams, apiKey: undefined, baseUrl: undefined }),
    ).toThrow(new ProviderError('Custom requires a base URL.', 'custom'));
  });

  it('requires a Workers AI account ID', () => {
    expect(() => buildChatRequest('workers_ai', commonParams)).toThrow(
      new ProviderError('Cloudflare Workers AI requires an account ID.', 'workers_ai'),
    );
  });

  it('rejects missing keys for providers without a keyless mode', () => {
    expect(() => buildChatRequest('openai', { ...commonParams, apiKey: undefined })).toThrow(
      new ProviderError('OpenAI requires an API key.', 'openai'),
    );
  });

  it('only sends OpenAI reasoning effort to supported models', () => {
    const unsupported = buildChatRequest('openai', {
      ...commonParams,
      model: 'gpt-4o',
      reasoningEffort: 'high',
    });
    const supported = buildChatRequest('openai', {
      ...commonParams,
      model: 'gpt-5',
      reasoningEffort: 'min',
    });
    const fixed = buildChatRequest('openai', {
      ...commonParams,
      model: 'gpt-5.3-chat-latest',
      reasoningEffort: 'high',
    });

    expect(unsupported.body).not.toHaveProperty('reasoning_effort');
    expect(supported.body).toHaveProperty('reasoning_effort', 'minimal');
    expect(fixed.body).toHaveProperty('reasoning_effort', 'medium');
  });

  it('only sends custom reasoning effort to KoboldCpp models', () => {
    const unsupported = buildChatRequest('custom', {
      ...commonParams,
      baseUrl: 'http://localhost:8080/v1',
      model: 'custom-model',
      reasoningEffort: 'high',
    });
    const kobold = buildChatRequest('custom', {
      ...commonParams,
      baseUrl: 'http://localhost:8080/v1',
      model: 'koboldcpp/local-model',
      reasoningEffort: 'high',
    });

    expect(unsupported.body).not.toHaveProperty('reasoning_effort');
    expect(kobold.body).toHaveProperty('reasoning_effort', 'high');
  });

  it('has an intentional dispatch result for every source', () => {
    for (const source of [
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
    ] as const) {
      try {
        buildChatRequest(source, {
          ...commonParams,
          baseUrl: 'https://example.test/v1',
          extra: {
            accountId: 'account-id',
            deploymentName: 'deployment',
            apiVersion: '2025-01-01-preview',
          },
        });
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect((error as Error).message).not.toContain('request building is not implemented');
      }
    }
  });
});
