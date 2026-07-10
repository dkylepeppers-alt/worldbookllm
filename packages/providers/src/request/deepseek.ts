/**
 * DeepSeek request building.
 *
 * Portions derived from SillyTavern (https://github.com/SillyTavern/SillyTavern),
 * AGPL-3.0, commit 29e0df488, src/endpoints/backends/chat-completions.js:1036.
 * Not ported in M1: tools, JSON schema, logprobs, or reverse proxies.
 */

import {
  addAssistantPrefix,
  postProcessPrompt,
  PROMPT_PROCESSING_TYPE,
} from '../convert/prompt-converters.js';
import { API_URLS } from '../sources.js';
import { makePromptNames, type GenerationParams, type ProviderChatRequest } from '../types.js';
import { chatCompletionsUrl, compactObject, requireApiKey } from './provider-helpers.js';

export function buildDeepSeekRequest(params: GenerationParams): ProviderChatRequest {
  const apiKey = requireApiKey('deepseek', params.apiKey);
  const messages = addAssistantPrefix(
    postProcessPrompt(
      structuredClone(params.messages),
      PROMPT_PROCESSING_TYPE.SEMI_TOOLS,
      params.names ?? makePromptNames(),
    ),
    undefined,
    'prefix',
  );
  return {
    url: chatCompletionsUrl(params.baseUrl?.trim() || API_URLS.deepseek),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: compactObject({
      messages,
      model: params.model,
      temperature: params.temperature,
      max_tokens: params.maxTokens,
      stream: params.stream,
      presence_penalty: params.presencePenalty,
      frequency_penalty: params.frequencyPenalty,
      top_p: params.topP,
      stop: params.stop,
      seed: params.seed,
      thinking: { type: params.includeReasoning ? 'enabled' : 'disabled' },
      reasoning_effort:
        params.includeReasoning && params.reasoningEffort ? params.reasoningEffort : undefined,
    }),
  };
}
