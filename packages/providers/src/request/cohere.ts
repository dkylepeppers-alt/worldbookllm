/**
 * Cohere request building.
 *
 * Portions derived from SillyTavern (https://github.com/SillyTavern/SillyTavern),
 * AGPL-3.0, commit 29e0df488, src/endpoints/backends/chat-completions.js:936.
 * Not ported in M1: tools, JSON schema, documents, or reverse proxies.
 */

import { convertCohereMessages } from '../convert/prompt-converters.js';
import { API_URLS } from '../sources.js';
import { makePromptNames, type GenerationParams, type ProviderChatRequest } from '../types.js';
import { compactObject, requireApiKey } from './provider-helpers.js';

export function buildCohereRequest(params: GenerationParams): ProviderChatRequest {
  const apiKey = requireApiKey('cohere', params.apiKey);
  const converted = convertCohereMessages(
    structuredClone(params.messages),
    params.names ?? makePromptNames(),
  );
  const body = compactObject({
    stream: params.stream,
    model: params.model,
    messages: converted.chatHistory,
    temperature: params.temperature,
    max_tokens: params.maxTokens,
    k: params.topK,
    p: params.topP,
    seed: params.seed,
    stop_sequences: params.stop,
    frequency_penalty: params.frequencyPenalty,
    presence_penalty: params.presencePenalty,
    documents: [],
    tools: [],
  });
  if (params.model.endsWith('08-2024')) {
    body.safety_mode = 'OFF';
  }
  return {
    url: `${API_URLS.cohereV2}/chat`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body,
  };
}
