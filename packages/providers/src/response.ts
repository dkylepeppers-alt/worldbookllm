/**
 * Non-streaming response normalization.
 *
 * Portions derived from SillyTavern (https://github.com/SillyTavern/SillyTavern),
 * AGPL-3.0, commit 29e0df488, public/scripts/openai.js:getStreamingReply.
 */

import { normalizeStreamChunk } from './stream/normalize.js';
import { ProviderError, type ChatCompletionSource, type CompletionResult } from './types.js';

export function parseCompletionResponse(
  source: ChatCompletionSource,
  data: unknown,
): CompletionResult {
  const result = normalizeStreamChunk(source, data);
  if (!result) {
    throw new ProviderError('Provider response did not contain completion data.', source);
  }
  return result;
}
