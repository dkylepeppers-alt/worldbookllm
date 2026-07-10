import { describe, expect, it } from 'vitest';

import { ProviderError, type ChatCompletionSource, type ModelListParams } from '../types.js';
import { buildModelListPlan, parseModelListResponse } from './list-models.js';

const keyed: ModelListParams = { apiKey: 'test-key' };

describe('model-list request plans', () => {
  it.each([
    ['openai', 'https://api.openai.com/v1/models'],
    ['openrouter', 'https://openrouter.ai/api/v1/models'],
    ['mistralai', 'https://api.mistral.ai/v1/models'],
    ['cohere', 'https://api.cohere.ai/v1/models'],
    ['chutes', 'https://llm.chutes.ai/v1/models'],
    ['electronhub', 'https://api.electronhub.ai/v1/models'],
    ['nanogpt', 'https://nano-gpt.com/api/v1/models'],
    ['deepseek', 'https://api.deepseek.com/beta/models'],
    ['xai', 'https://api.x.ai/v1/models'],
    ['aimlapi', 'https://api.aimlapi.com/v1/models'],
    ['groq', 'https://api.groq.com/openai/v1/models'],
    ['moonshot', 'https://api.moonshot.ai/v1/models'],
    ['fireworks', 'https://api.fireworks.ai/inference/v1/models'],
  ] as const)('builds the pinned %s models URL', (source, url) => {
    expect(buildModelListPlan(source, keyed).requests[0]).toMatchObject({
      url,
      method: 'GET',
      headers: { Authorization: 'Bearer test-key' },
    });
  });

  it('adds OpenRouter and AI/ML identity headers', () => {
    expect(buildModelListPlan('openrouter', keyed).requests[0]?.headers).toMatchObject({
      'HTTP-Referer': 'https://github.com/dkylepeppers-alt/worldbookllm',
      'X-Title': 'worldbookllm',
    });
    expect(buildModelListPlan('aimlapi', keyed).requests[0]?.headers).toMatchObject({
      'HTTP-Referer': 'https://github.com/dkylepeppers-alt/worldbookllm',
      'X-Title': 'worldbookllm',
    });
  });

  it('builds keyless custom and anonymous Pollinations plans', () => {
    expect(
      buildModelListPlan('custom', { baseUrl: 'http://localhost:8080/v1/' }).requests[0],
    ).toEqual({
      url: 'http://localhost:8080/v1/models',
      method: 'GET',
      headers: {},
    });
    expect(buildModelListPlan('pollinations', {}).requests[0]).toEqual({
      url: 'https://gen.pollinations.ai/text/models',
      method: 'GET',
      headers: { Authorization: 'Bearer anonymous' },
    });
  });

  it('builds the Google AI Studio models plan', () => {
    expect(buildModelListPlan('makersuite', keyed).requests[0]).toEqual({
      url: 'https://generativelanguage.googleapis.com/v1beta/models?key=test-key',
      method: 'GET',
      headers: {},
    });
  });

  it('builds SiliconFlow and Workers AI query parameters', () => {
    expect(
      buildModelListPlan('siliconflow', { ...keyed, extra: { region: 'cn' } }).requests[0]?.url,
    ).toBe('https://api.siliconflow.cn/v1/models?type=text&sub_type=chat');
    expect(
      buildModelListPlan('workers_ai', {
        ...keyed,
        extra: { accountId: 'account/id' },
      }).requests[0]?.url,
    ).toBe(
      'https://api.cloudflare.com/client/v4/accounts/account%2Fid/ai/models/search?task=Text+Generation&per_page=1000',
    );
  });

  it('builds the pinned two-step Azure plan', () => {
    expect(
      buildModelListPlan('azure_openai', {
        ...keyed,
        baseUrl: 'https://example.openai.azure.com/',
        extra: { deploymentName: 'story', apiVersion: '2025-01-01-preview' },
      }).requests,
    ).toEqual([
      {
        url: 'https://example.openai.azure.com/openai/models?api-version=2025-01-01-preview',
        method: 'GET',
        headers: { Accept: 'application/json', 'api-key': 'test-key' },
      },
      {
        url: 'https://example.openai.azure.com/openai/deployments/story/chat/completions?api-version=2025-01-01-preview',
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'api-key': 'test-key',
        },
        body: {
          messages: [{ role: 'user', content: 'Say word Hi' }],
          stream: false,
          max_completion_tokens: 5,
        },
      },
    ]);
  });

  it.each(['claude', 'ai21', 'vertexai', 'perplexity', 'minimax', 'zai'] as const)(
    'returns a static plan for %s',
    (source) => {
      const plan = buildModelListPlan(source, {});
      expect(plan.requests).toEqual([]);
      expect(plan.staticModels?.length).toBeGreaterThan(0);
    },
  );

  it('keeps CometAPI disabled and validates required config', () => {
    expect(() => buildModelListPlan('cometapi', keyed)).toThrow(
      new ProviderError('CometAPI is temporarily disabled.', 'cometapi'),
    );
    expect(() => buildModelListPlan('custom', {})).toThrow(
      new ProviderError('Custom requires a base URL.', 'custom'),
    );
    expect(() => buildModelListPlan('workers_ai', keyed)).toThrow(
      new ProviderError('Cloudflare Workers AI requires an account ID.', 'workers_ai'),
    );
  });
});

describe('model-list response parsing', () => {
  it('normalizes standard data envelopes and drops invalid IDs', () => {
    expect(
      parseModelListResponse('openai', {
        data: [{ id: 'gpt-test', owned_by: 'openai' }, { name: 'missing-id' }, null],
      }),
    ).toEqual([{ id: 'gpt-test', owned_by: 'openai' }]);
  });

  it('normalizes Cohere, Pollinations, and Workers AI envelopes', () => {
    expect(parseModelListResponse('cohere', { models: [{ name: 'command-r' }] })).toEqual([
      { id: 'command-r', name: 'command-r' },
    ]);
    expect(parseModelListResponse('pollinations', [{ name: 'openai' }])).toEqual([
      { id: 'openai', name: 'openai' },
    ]);
    expect(
      parseModelListResponse('workers_ai', { result: [{ name: '@cf/model', task: 'text' }] }),
    ).toEqual([{ id: '@cf/model', name: '@cf/model', task: 'text' }]);
  });

  it('filters Google models to generateContent support', () => {
    expect(
      parseModelListResponse('makersuite', {
        models: [
          { name: 'models/gemini', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/embed', supportedGenerationMethods: ['embedContent'] },
        ],
      }),
    ).toEqual([
      {
        id: 'gemini',
        name: 'models/gemini',
        supportedGenerationMethods: ['generateContent'],
      },
    ]);
  });

  it('normalizes Chutes pricing and Azure detected models', () => {
    expect(
      parseModelListResponse('chutes', {
        data: [{ id: 'chute', pricing: { prompt: 1, completion: 2 } }],
      }),
    ).toEqual([{ id: 'chute', pricing: { prompt: 1, completion: 2, input: 1, output: 2 } }]);
    expect(parseModelListResponse('azure_openai', { model: 'gpt-deployment' }, 1)).toEqual([
      { id: 'gpt-deployment' },
    ]);
  });

  it.each(['openai', 'cohere', 'makersuite', 'workers_ai'] as ChatCompletionSource[])(
    'rejects malformed successful %s bodies',
    (source) => {
      expect(() => parseModelListResponse(source, { unexpected: true })).toThrow(ProviderError);
    },
  );
});
