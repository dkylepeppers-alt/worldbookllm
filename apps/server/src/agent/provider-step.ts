import {
  ProviderError,
  ToolCallAccumulator,
  normalizeStreamChunk,
  parseSseStream,
  type ProviderChatRequest,
  type StreamedToolCall,
} from '@worldbookllm/providers';
import type { ProviderConfig } from '@worldbookllm/shared';

import type { ProviderService } from '../services/providers.js';

/** One streamed model response: its text, its reasoning, and the tools it called. */
export interface StreamedStep {
  text: string;
  reasoning: string;
  calls: StreamedToolCall[];
}

/**
 * Streams one request and collects the response. A stream with neither
 * completion data nor a tool call is a provider error, as the ordinary
 * generation path treats it: a tool call counts as data, a blank step does
 * not.
 */
export async function streamStep(
  providers: ProviderService,
  config: ProviderConfig,
  request: ProviderChatRequest,
  signal: AbortSignal,
  onDelta: (delta: { text: string; reasoning?: string }) => void = () => undefined,
): Promise<StreamedStep> {
  const accumulator = new ToolCallAccumulator();
  let sawCompletion = false;
  let text = '';
  let reasoning = '';
  const stream = await providers.openChatStream(config.source, request, signal);
  for await (const event of parseSseStream(stream)) {
    if (event.data === '[DONE]') break;
    let payload: unknown;
    try {
      payload = JSON.parse(event.data);
    } catch {
      throw new ProviderError('Provider stream contained invalid JSON.', config.source);
    }
    accumulator.push(payload);
    const delta = normalizeStreamChunk(config.source, payload);
    if (!delta) continue;
    sawCompletion = true;
    text += delta.text;
    reasoning += delta.reasoning ?? '';
    onDelta({ text: delta.text, ...(delta.reasoning ? { reasoning: delta.reasoning } : {}) });
  }
  const calls = accumulator.toolCalls();
  if (calls.length === 0 && !sawCompletion) {
    throw new ProviderError('Provider stream contained no completion data.', config.source);
  }
  return { text, reasoning, calls };
}

/**
 * Arguments sent back to the provider. A malformed JSON string would make
 * Claude's next request fail to build (`JSON.parse` in convertClaudeMessages),
 * so the provider sees an empty object and the tool result carries the error.
 * The recorded step keeps the raw string.
 */
export function providerToolArguments(raw: string): string {
  try {
    JSON.parse(raw);
    return raw;
  } catch {
    return '{}';
  }
}

/** Gemma 3 on Google sources is sent no tools (see buildGoogleRequest). */
export function googleModelWithoutTools(config: ProviderConfig): boolean {
  return (
    (config.source === 'makersuite' || config.source === 'vertexai') && /gemma-3/.test(config.model)
  );
}
