/**
 * MiniMax request building.
 *
 * Portions derived from SillyTavern (https://github.com/SillyTavern/SillyTavern),
 * AGPL-3.0, commit 29e0df488, src/endpoints/backends/chat-completions.js:1572.
 * Not ported in M1: tools or reverse proxies.
 */

import { postProcessPrompt, PROMPT_PROCESSING_TYPE } from '../convert/prompt-converters.js';
import { API_URLS } from '../sources.js';
import { makePromptNames, type GenerationParams, type ProviderChatRequest } from '../types.js';
import {
  chatCompletionsUrl,
  compactObject,
  extraString,
  requireApiKey,
} from './provider-helpers.js';

export function buildMinimaxRequest(params: GenerationParams): ProviderChatRequest {
  const apiKey = requireApiKey('minimax', params.apiKey);
  const baseUrl =
    extraString(params.extra, 'region') === 'cn' ? API_URLS.minimaxCn : API_URLS.minimax;
  return {
    url: chatCompletionsUrl(params.baseUrl?.trim() || baseUrl),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: compactObject({
      messages: postProcessPrompt(
        structuredClone(params.messages),
        PROMPT_PROCESSING_TYPE.MERGE_TOOLS,
        params.names ?? makePromptNames(),
      ),
      model: params.model,
      temperature: params.temperature,
      max_tokens:
        params.model === 'M2-her' && params.maxTokens !== undefined
          ? Math.min(params.maxTokens, 2048)
          : params.maxTokens,
      stream: params.stream,
      top_p: params.topP,
      stop: params.stop,
    }),
  };
}
