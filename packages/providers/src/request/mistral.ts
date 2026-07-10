/**
 * Mistral AI request building.
 *
 * Portions derived from SillyTavern (https://github.com/SillyTavern/SillyTavern),
 * AGPL-3.0, commit 29e0df488, src/endpoints/backends/chat-completions.js:846.
 * Not ported in M1: tools, JSON schema, or reverse proxies.
 */

import { convertMistralMessages } from '../convert/prompt-converters.js';
import { API_URLS } from '../sources.js';
import { makePromptNames, type GenerationParams, type ProviderChatRequest } from '../types.js';
import {
  chatCompletionsUrl,
  compactObject,
  extraBoolean,
  requireApiKey,
} from './provider-helpers.js';

export function buildMistralRequest(params: GenerationParams): ProviderChatRequest {
  const apiKey = requireApiKey('mistralai', params.apiKey);
  return {
    url: chatCompletionsUrl(params.baseUrl?.trim() || API_URLS.mistralai),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: compactObject({
      model: params.model,
      messages: convertMistralMessages(
        structuredClone(params.messages),
        params.names ?? makePromptNames(),
      ),
      temperature: params.temperature,
      top_p: params.topP,
      frequency_penalty: params.frequencyPenalty,
      presence_penalty: params.presencePenalty,
      max_tokens: params.maxTokens,
      stream: params.stream,
      safe_prompt: extraBoolean(params.extra, 'safePrompt'),
      random_seed: params.seed === -1 ? undefined : params.seed,
      stop: params.stop?.length ? params.stop : undefined,
    }),
  };
}
