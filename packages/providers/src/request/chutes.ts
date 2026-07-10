/**
 * Chutes request building.
 *
 * Portions derived from SillyTavern (https://github.com/SillyTavern/SillyTavern),
 * AGPL-3.0, commit 29e0df488, src/endpoints/backends/chat-completions.js:1471.
 * Not ported in M1: tools, JSON schema, logprobs, or reverse proxies.
 */

import { API_URLS } from '../sources.js';
import { type GenerationParams, type ProviderChatRequest } from '../types.js';
import { chatCompletionsUrl, compactObject, requireApiKey } from './provider-helpers.js';

function extraNumber(params: GenerationParams, key: string): number | undefined {
  const value = params.extra?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function extraRecord(params: GenerationParams, key: string): Record<string, unknown> | undefined {
  const value = params.extra?.[key];
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function buildChutesRequest(params: GenerationParams): ProviderChatRequest {
  const apiKey = requireApiKey('chutes', params.apiKey);
  return {
    url: chatCompletionsUrl(params.baseUrl?.trim() || API_URLS.chutes),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: compactObject({
      messages: structuredClone(params.messages),
      model: params.model,
      temperature: params.temperature,
      max_tokens: params.maxTokens,
      stream: params.stream,
      presence_penalty: params.presencePenalty,
      frequency_penalty: params.frequencyPenalty,
      repetition_penalty: extraNumber(params, 'repetitionPenalty'),
      min_p: extraNumber(params, 'minP'),
      top_p: params.topP,
      top_k: params.topK,
      seed: params.seed,
      stop: params.stop,
      reasoning_effort: params.reasoningEffort,
      logit_bias: extraRecord(params, 'logitBias'),
    }),
  };
}
