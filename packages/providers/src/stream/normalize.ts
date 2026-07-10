/**
 * Streaming delta normalization.
 *
 * Portions derived from SillyTavern (https://github.com/SillyTavern/SillyTavern),
 * AGPL-3.0, commit 29e0df488, public/scripts/openai.js:getStreamingReply.
 * Images, tool calls, signatures, logprobs, and multi-swipe state are not ported.
 */

import { ProviderError, type ChatCompletionSource, type StreamDelta } from '../types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function firstChoice(payload: Record<string, unknown>): Record<string, unknown> {
  const choices = payload.choices;
  return Array.isArray(choices) ? asRecord(choices[0]) : {};
}

function contentText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((part) => asRecord(part).text)
      .filter((text): text is string => typeof text === 'string')
      .join('');
  }
  return '';
}

function firstString(...values: unknown[]): string {
  return values.find((value): value is string => typeof value === 'string') ?? '';
}

function providerError(source: ChatCompletionSource, payload: Record<string, unknown>): void {
  const topLevelMessage = typeof payload.message === 'string' ? payload.message : undefined;
  const topLevelStatus = typeof payload.status === 'number' ? payload.status : undefined;

  if (isRecord(payload.error)) {
    const message =
      typeof payload.error.message === 'string'
        ? payload.error.message
        : (topLevelMessage ?? 'Provider returned an error.');
    const status = typeof payload.error.status === 'number' ? payload.error.status : topLevelStatus;
    throw new ProviderError(message, source, status);
  }

  if (typeof payload.error === 'string') {
    throw new ProviderError(payload.error || 'Provider returned an error.', source, topLevelStatus);
  }

  if (payload.error) {
    throw new ProviderError(
      topLevelMessage ?? 'Provider returned an error.',
      source,
      topLevelStatus,
    );
  }

  if (topLevelMessage && !Array.isArray(payload.choices)) {
    throw new ProviderError(topLevelMessage, source, topLevelStatus);
  }
}

export function normalizeStreamChunk(
  source: ChatCompletionSource,
  data: unknown,
): StreamDelta | null {
  const payload = asRecord(data);
  providerError(source, payload);

  const choice = firstChoice(payload);
  const delta = asRecord(choice.delta);
  const message = asRecord(choice.message);
  const text =
    contentText(delta.content) || contentText(message.content) || contentText(choice.text);

  const reasoning =
    source === 'openrouter'
      ? firstString(
          delta.reasoning,
          delta.reasoning_content,
          message.reasoning,
          message.reasoning_content,
        )
      : firstString(
          delta.reasoning_content,
          delta.reasoning,
          message.reasoning_content,
          message.reasoning,
        );

  if (!text && !reasoning) {
    return null;
  }
  return {
    text,
    ...(reasoning ? { reasoning } : {}),
  };
}
