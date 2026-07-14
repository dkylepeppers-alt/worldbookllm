import { apiErrorSchema, streamEventSchema, type StreamEvent } from '@worldbookllm/shared';

import { ApiClientError } from './client.js';

export interface StreamChatOptions {
  onEvent: (event: StreamEvent) => void;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

function invalidResponse(): ApiClientError {
  return new ApiClientError(200, 'invalid_response', 'The server returned an invalid response.');
}

function dataOf(rawFrame: string): string | null {
  const lines = rawFrame
    .split('\n')
    .map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line))
    .filter((line) => line.startsWith('data:'));
  if (lines.length === 0) return null;
  return lines.map((line) => line.slice('data:'.length).trimStart()).join('\n');
}

function emitFrame(rawFrame: string, onEvent: (event: StreamEvent) => void): void {
  const data = dataOf(rawFrame);
  if (data === null) return;
  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch {
    throw invalidResponse();
  }
  const parsed = streamEventSchema.safeParse(payload);
  if (!parsed.success) throw invalidResponse();
  onEvent(parsed.data);
}

/**
 * Sends a user message with `POST /api/chats/:id/messages` and consumes the
 * SSE response with a fetch reader (`EventSource` cannot POST a body or take
 * an `AbortSignal`). Resolves when the server closes the stream after its
 * terminal `done`/`error` event; rejects on abort, transport failure, HTTP
 * errors before the stream begins, and malformed or invalid frames.
 */
export async function streamChatMessage(
  chatId: string,
  content: string,
  options: StreamChatOptions,
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  let response: Response;
  try {
    response = await fetchImpl(`/api/chats/${encodeURIComponent(chatId)}/messages`, {
      method: 'POST',
      headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiClientError(0, 'network_error', 'Could not reach the server.');
  }

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => undefined);
    const parsed = apiErrorSchema.safeParse(body);
    if (parsed.success) {
      throw new ApiClientError(
        response.status,
        parsed.data.error,
        parsed.data.message,
        parsed.data.issues,
      );
    }
    throw new ApiClientError(
      response.status,
      'http_error',
      response.statusText || `Request failed with status ${response.status}.`,
    );
  }

  if (response.body === null) throw invalidResponse();

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const frameBoundary = /\r?\n\r?\n/;
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let boundary = frameBoundary.exec(buffer);
      while (boundary !== null) {
        emitFrame(buffer.slice(0, boundary.index), options.onEvent);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        boundary = frameBoundary.exec(buffer);
      }
      if (done) {
        // A stream that closes without a trailing blank line still delivered
        // its final frame.
        if (buffer.trim().length > 0) emitFrame(buffer, options.onEvent);
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
