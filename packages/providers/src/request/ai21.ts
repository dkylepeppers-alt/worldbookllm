/**
 * AI21 request building.
 *
 * Portions derived from SillyTavern (https://github.com/SillyTavern/SillyTavern),
 * AGPL-3.0, commit 29e0df488, src/endpoints/backends/chat-completions.js:765.
 * Not ported in M1: tools, JSON schema, or reverse proxies.
 */

import { convertAI21Messages } from '../convert/prompt-converters.js';
import { API_URLS } from '../sources.js';
import { makePromptNames, type GenerationParams, type ProviderChatRequest } from '../types.js';
import { compactObject, requireApiKey } from './provider-helpers.js';

export function buildAi21Request(params: GenerationParams): ProviderChatRequest {
  const apiKey = requireApiKey('ai21', params.apiKey);
  return {
    url: `${(params.baseUrl?.trim() || API_URLS.ai21).replace(/\/+$/, '')}/chat/completions`,
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: compactObject({
      messages: convertAI21Messages(
        structuredClone(params.messages),
        params.names ?? makePromptNames(),
      ),
      model: params.model,
      max_tokens: params.maxTokens,
      temperature: params.temperature,
      top_p: params.topP,
      stop: params.stop,
      stream: params.stream,
    }),
  };
}
