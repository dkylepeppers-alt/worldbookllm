/**
 * Provider request dispatcher.
 *
 * Portions derived from SillyTavern (https://github.com/SillyTavern/SillyTavern),
 * AGPL-3.0, commit 29e0df488, src/endpoints/backends/chat-completions.js.
 */

import { PROVIDER_META } from '../sources.js';
import {
  ProviderError,
  type ChatCompletionSource,
  type GenerationParams,
  type ProviderChatRequest,
} from '../types.js';
import { buildOpenAiCompatibleRequest, isOpenAiCompatibleSource } from './openai-compatible.js';

export function buildChatRequest(
  source: ChatCompletionSource,
  params: GenerationParams,
): ProviderChatRequest {
  if (isOpenAiCompatibleSource(source)) {
    return buildOpenAiCompatibleRequest(source, params);
  }

  throw new ProviderError(
    `${PROVIDER_META[source].label} request building is not implemented.`,
    source,
  );
}
