/**
 * xAI request building.
 *
 * Portions derived from SillyTavern (https://github.com/SillyTavern/SillyTavern),
 * AGPL-3.0, commit 29e0df488, src/endpoints/backends/chat-completions.js:1148.
 * Not ported in M1: tools, JSON schema, logprobs, or reverse proxies.
 */

import { convertXAIMessages } from '../convert/prompt-converters.js';
import { API_URLS } from '../sources.js';
import { makePromptNames, type GenerationParams, type ProviderChatRequest } from '../types.js';
import { chatCompletionsUrl, compactObject, requireApiKey } from './provider-helpers.js';

export function buildXaiRequest(params: GenerationParams): ProviderChatRequest {
  const apiKey = requireApiKey('xai', params.apiKey);
  return {
    url: chatCompletionsUrl(params.baseUrl?.trim() || API_URLS.xai),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: compactObject({
      messages: convertXAIMessages(
        structuredClone(params.messages),
        params.names ?? makePromptNames(),
      ),
      model: params.model,
      temperature: params.temperature,
      max_tokens: params.maxTokens,
      stream: params.stream,
      presence_penalty: params.presencePenalty,
      frequency_penalty: params.frequencyPenalty,
      top_p: params.topP,
      seed: params.seed,
      stop: params.stop?.length ? params.stop : undefined,
      reasoning_effort:
        params.reasoningEffort && params.reasoningEffort !== 'auto'
          ? params.reasoningEffort === 'high' || params.reasoningEffort === 'max'
            ? 'high'
            : 'low'
          : undefined,
    }),
  };
}
