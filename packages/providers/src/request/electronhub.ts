/**
 * Electron Hub request building.
 *
 * Portions derived from SillyTavern (https://github.com/SillyTavern/SillyTavern),
 * AGPL-3.0, commit 29e0df488, src/endpoints/backends/chat-completions.js:1359.
 * Not ported in M1: tools, JSON schema, web search, prompt caching, or reverse proxies.
 */

import { API_URLS } from '../sources.js';
import { type GenerationParams, type ProviderChatRequest } from '../types.js';
import { chatCompletionsUrl, compactObject, requireApiKey } from './provider-helpers.js';

export function buildElectronHubRequest(params: GenerationParams): ProviderChatRequest {
  const apiKey = requireApiKey('electronhub', params.apiKey);
  return {
    url: chatCompletionsUrl(params.baseUrl?.trim() || API_URLS.electronhub),
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
      top_p: params.topP,
      top_k: params.topK,
      seed: params.seed,
      reasoning_effort: params.reasoningEffort,
    }),
  };
}
