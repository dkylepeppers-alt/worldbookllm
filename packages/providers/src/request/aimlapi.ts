/**
 * AI/ML API request building.
 *
 * Portions derived from SillyTavern (https://github.com/SillyTavern/SillyTavern),
 * AGPL-3.0, commit 29e0df488, src/endpoints/backends/chat-completions.js:1254.
 * Not ported in M1: tools, JSON schema, logprobs, or reverse proxies.
 */

import { API_URLS } from '../sources.js';
import { type GenerationParams, type ProviderChatRequest } from '../types.js';
import { chatCompletionsUrl, compactObject, requireApiKey } from './provider-helpers.js';

const AIMLAPI_HEADERS = {
  'HTTP-Referer': 'https://github.com/dkylepeppers-alt/worldbookllm',
  'X-Title': 'worldbookllm',
};

export function buildAimlapiRequest(params: GenerationParams): ProviderChatRequest {
  const apiKey = requireApiKey('aimlapi', params.apiKey);
  return {
    url: chatCompletionsUrl(params.baseUrl?.trim() || API_URLS.aimlapi),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...AIMLAPI_HEADERS,
    },
    body: compactObject({
      messages: structuredClone(params.messages),
      model: params.model,
      temperature: params.temperature,
      max_tokens: params.maxTokens,
      stream: params.stream,
      presence_penalty: params.presencePenalty,
      frequency_penalty: params.frequencyPenalty,
      top_p: params.topP,
      seed: params.seed,
      stop: params.stop?.length ? params.stop : undefined,
      reasoning_effort: params.reasoningEffort,
    }),
  };
}
