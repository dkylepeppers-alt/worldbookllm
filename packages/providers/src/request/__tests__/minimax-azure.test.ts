import { describe, expect, it } from 'vitest';

import { ProviderError, type GenerationParams } from '../../types.js';
import { buildChatRequest } from '../build-request.js';

const params: GenerationParams = {
  model: 'test-model',
  messages: [{ role: 'user', content: 'Describe the brass moon.' }],
  stream: true,
  apiKey: 'test-key',
  maxTokens: 4096,
  temperature: 0.7,
  topP: 0.9,
  frequencyPenalty: 0.1,
  presencePenalty: 0.2,
  stop: ['END'],
  seed: 7,
};

describe('MiniMax request building', () => {
  it('uses the CN endpoint and caps M2-her output tokens', () => {
    expect(
      buildChatRequest('minimax', {
        ...params,
        model: 'M2-her',
        extra: { region: 'cn' },
      }),
    ).toEqual({
      url: 'https://api.minimaxi.com/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-key',
      },
      body: {
        messages: [{ role: 'user', content: 'Describe the brass moon.' }],
        model: 'M2-her',
        temperature: 0.7,
        max_tokens: 2048,
        stream: true,
        top_p: 0.9,
        stop: ['END'],
      },
    });
  });
});

describe('Azure OpenAI request building', () => {
  it('builds the deployment URL and pinned body', () => {
    expect(
      buildChatRequest('azure_openai', {
        ...params,
        model: 'gpt-5',
        reasoningEffort: 'min',
        baseUrl: 'https://example.openai.azure.com/',
        extra: { deploymentName: 'story', apiVersion: '2025-01-01-preview' },
      }),
    ).toEqual({
      url: 'https://example.openai.azure.com/openai/deployments/story/chat/completions?api-version=2025-01-01-preview',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': 'test-key',
      },
      body: {
        messages: [{ role: 'user', content: 'Describe the brass moon.' }],
        temperature: 0.7,
        frequency_penalty: 0.1,
        presence_penalty: 0.2,
        top_p: 0.9,
        max_tokens: 4096,
        stream: true,
        stop: ['END'],
        seed: 7,
        reasoning_effort: 'minimal',
      },
    });
  });

  it('reports incomplete Azure configuration without exposing credentials', () => {
    expect(() =>
      buildChatRequest('azure_openai', {
        ...params,
        baseUrl: 'https://example.openai.azure.com/',
        extra: { apiVersion: '2025-01-01-preview' },
      }),
    ).toThrow(
      new ProviderError(
        'Azure OpenAI requires a base URL, deployment name, API version, and API key.',
        'azure_openai',
      ),
    );
  });
});
