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

function result(text: string, reasoning = ''): StreamDelta | null {
  if (!text && !reasoning) {
    return null;
  }
  return { text, ...(reasoning ? { reasoning } : {}) };
}

function normalizeClaude(payload: Record<string, unknown>): StreamDelta | null {
  const delta = asRecord(payload.delta);
  const content = payload.content;
  const reasoning = Array.isArray(content)
    ? content
        .map((part) => asRecord(part).thinking)
        .filter((thinking): thinking is string => typeof thinking === 'string')
        .join('')
    : '';
  return result(
    contentText(delta.text) || contentText(content),
    firstString(delta.thinking, reasoning),
  );
}

function normalizeGoogle(payload: Record<string, unknown>): StreamDelta | null {
  const candidates = payload.candidates;
  const candidate = Array.isArray(candidates) ? asRecord(candidates[0]) : {};
  const parts = asRecord(candidate.content).parts;
  if (!Array.isArray(parts)) {
    return null;
  }
  const visible = parts.find((part) => asRecord(part).thought !== true);
  const thought = parts.find((part) => asRecord(part).thought === true);
  return result(firstString(asRecord(visible).text), firstString(asRecord(thought).text));
}

function normalizeCohere(payload: Record<string, unknown>): StreamDelta | null {
  const deltaMessage = asRecord(asRecord(payload.delta).message);
  const completeMessage = asRecord(payload.message);
  const message = Object.keys(deltaMessage).length ? deltaMessage : completeMessage;
  const content = message.content;
  return result(contentText(content) || firstString(asRecord(content).text, message.tool_plan));
}

function mistralReasoning(choice: Record<string, unknown>): string {
  const delta = asRecord(choice.delta);
  const message = asRecord(choice.message);
  const content = delta.content ?? message.content;
  if (!Array.isArray(content)) {
    return '';
  }
  for (const part of content) {
    const thinking = asRecord(part).thinking;
    if (Array.isArray(thinking)) {
      const text = firstString(asRecord(thinking[0]).text);
      if (text) {
        return text;
      }
    }
  }
  return '';
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

  if (source === 'claude') {
    return normalizeClaude(payload);
  }
  if (source === 'makersuite' || source === 'vertexai') {
    return normalizeGoogle(payload);
  }
  if (source === 'cohere') {
    return normalizeCohere(payload);
  }

  const choice = firstChoice(payload);
  const delta = asRecord(choice.delta);
  const message = asRecord(choice.message);
  const text =
    contentText(delta.content) || contentText(message.content) || contentText(choice.text);

  const reasoning =
    source === 'mistralai'
      ? mistralReasoning(choice)
      : source === 'openrouter'
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

  return result(text, reasoning);
}
