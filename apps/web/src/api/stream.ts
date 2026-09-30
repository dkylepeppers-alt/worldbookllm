import {
  agentStreamEventSchema,
  apiErrorSchema,
  type AgentStreamEvent,
} from '@worldbookllm/shared';

import { ApiClientError } from './client.js';

export interface StreamOptions<E> {
  onEvent: (event: E) => void;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

interface EventSchema<E> {
  safeParse(value: unknown): { success: true; data: E } | { success: false };
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

function emitFrame<E>(rawFrame: string, schema: EventSchema<E>, onEvent: (event: E) => void): void {
  const data = dataOf(rawFrame);
  if (data === null) return;
  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch {
    throw invalidResponse();
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw invalidResponse();
  onEvent(parsed.data);
}

/**
 * POSTs to an SSE endpoint and consumes the stream with a fetch reader
 * (`EventSource` cannot POST a body or take an `AbortSignal`). Resolves when the
 * server closes the stream after its terminal `done`/`error` event; rejects on
 * abort, transport failure, HTTP errors before the stream begins, and malformed
 * or invalid frames. Pass `undefined` for `body` on endpoints that take none.
 */
async function streamSse<E extends { type: string }>(
  path: string,
  body: unknown,
  schema: EventSchema<E>,
  options: StreamOptions<E>,
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  let response: Response;
  try {
    response = await fetchImpl(path, {
      method: 'POST',
      headers: {
        Accept: 'text/event-stream',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
  let sawTerminal = false;
  const emit = (rawFrame: string) => {
    emitFrame(rawFrame, schema, (event) => {
      if (event.type === 'done' || event.type === 'error') sawTerminal = true;
      options.onEvent(event);
    });
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let boundary = frameBoundary.exec(buffer);
      while (boundary !== null) {
        emit(buffer.slice(0, boundary.index));
        buffer = buffer.slice(boundary.index + boundary[0].length);
        boundary = frameBoundary.exec(buffer);
      }
      if (done) {
        // A stream that closes without a trailing blank line still delivered
        // its final frame.
        if (buffer.trim().length > 0) emit(buffer);
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  // The server always closes with a `done` or `error` event; a 200 stream
  // that ends without one was truncated (or wasn't SSE at all) and must not
  // pass for a successful exchange.
  if (!sawTerminal) throw invalidResponse();
}

/**
 * Sends a message to an agent chat with `POST /api/agent-chats/:id/messages`.
 * The turn's steps, tool calls, and checkpoint arrive before `done`/`error`.
 * Aborting stops the turn; the server records it as interrupted and still
 * commits its checkpoint, but sends no further events.
 */
export function streamAgentMessage(
  chatId: string,
  content: string,
  options: StreamOptions<AgentStreamEvent>,
): Promise<void> {
  return streamSse(
    `/api/agent-chats/${encodeURIComponent(chatId)}/messages`,
    { content },
    agentStreamEventSchema,
    options,
  );
}
