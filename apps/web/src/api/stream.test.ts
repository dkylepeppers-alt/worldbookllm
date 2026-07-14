import type { Message, StreamEvent } from '@worldbookllm/shared';
import { describe, expect, it, vi } from 'vitest';

import { ApiClientError } from './client.js';
import { streamChatMessage } from './stream.js';

const chatId = '60a0bf0c-031d-497c-9c1a-2f68441936a6';

const assistantMessage: Message = {
  id: '0c8f34e8-96b5-4c62-8f2e-27e6a9f14d55',
  chatId,
  seq: 1,
  role: 'assistant',
  content: 'Hello there.',
  reasoning: null,
  status: 'complete',
  context: {
    sourceIds: [],
    provider: 'nanogpt',
    model: 'nano-story',
    strictness: 'grounded',
  },
  createdAt: '2026-07-14T12:00:00.000Z',
};

function frame(event: StreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8' },
  });
}

describe('streamChatMessage', () => {
  it('posts the user message and emits events split across chunk boundaries', async () => {
    const first = frame({ type: 'delta', text: 'Hel' });
    const second = frame({ type: 'delta', text: 'lo' });
    const done = frame({ type: 'done', message: assistantMessage });
    const wire = first + second + done;
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(sseResponse([wire.slice(0, 10), wire.slice(10, 11), wire.slice(11)]));
    const events: StreamEvent[] = [];

    await streamChatMessage(chatId, 'Hi', { onEvent: (event) => events.push(event), fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(
      `/api/chats/${chatId}/messages`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ content: 'Hi' }) }),
    );
    expect(events).toEqual([
      { type: 'delta', text: 'Hel' },
      { type: 'delta', text: 'lo' },
      { type: 'done', message: assistantMessage },
    ]);
  });

  it('emits several events arriving in a single chunk', async () => {
    const wire =
      frame({ type: 'delta', text: 'a', reasoning: 'thinking' }) +
      frame({ type: 'delta', text: 'b' }) +
      frame({ type: 'done', message: assistantMessage });
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse([wire]));
    const events: StreamEvent[] = [];

    await streamChatMessage(chatId, 'Hi', { onEvent: (event) => events.push(event), fetchImpl });

    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({ type: 'delta', text: 'a', reasoning: 'thinking' });
  });

  it('emits a validated error event with its persisted message state', async () => {
    const errored: Message = { ...assistantMessage, content: 'partial', status: 'error' };
    const wire = frame({
      type: 'error',
      code: 'provider_error',
      message: 'Provider generation failed',
      messageState: errored,
    });
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse([wire]));
    const events: StreamEvent[] = [];

    await streamChatMessage(chatId, 'Hi', { onEvent: (event) => events.push(event), fetchImpl });

    expect(events).toEqual([
      {
        type: 'error',
        code: 'provider_error',
        message: 'Provider generation failed',
        messageState: errored,
      },
    ]);
  });

  it('parses CRLF-delimited frames', async () => {
    const wire =
      `event: delta\r\ndata: {"type":"delta","text":"a"}\r\n\r\n` +
      `event: done\r\ndata: ${JSON.stringify({ type: 'done', message: assistantMessage })}\r\n\r\n`;
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse([wire]));
    const events: StreamEvent[] = [];

    await streamChatMessage(chatId, 'Hi', { onEvent: (event) => events.push(event), fetchImpl });

    expect(events).toEqual([
      { type: 'delta', text: 'a' },
      { type: 'done', message: assistantMessage },
    ]);
  });

  it('emits a final frame that lacks the trailing blank line', async () => {
    const wire =
      'event: delta\ndata: {"type":"delta","text":"a"}\n\n' +
      `event: done\ndata: ${JSON.stringify({ type: 'done', message: assistantMessage })}`;
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse([wire]));
    const events: StreamEvent[] = [];

    await streamChatMessage(chatId, 'Hi', { onEvent: (event) => events.push(event), fetchImpl });

    expect(events).toEqual([
      { type: 'delta', text: 'a' },
      { type: 'done', message: assistantMessage },
    ]);
  });

  it('rejects a stream that closes without a terminal done/error event', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(sseResponse(['event: delta\ndata: {"type":"delta","text":"a"}\n\n']));

    await expect(
      streamChatMessage(chatId, 'Hi', { onEvent: () => undefined, fetchImpl }),
    ).rejects.toBeInstanceOf(ApiClientError);
  });

  it('rejects on a frame that is not valid JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse(['event: delta\ndata: {nope\n\n']));

    await expect(
      streamChatMessage(chatId, 'Hi', { onEvent: () => undefined, fetchImpl }),
    ).rejects.toBeInstanceOf(ApiClientError);
  });

  it('rejects on a payload that fails stream-event validation', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(sseResponse(['event: delta\ndata: {"type":"delta"}\n\n']));

    await expect(
      streamChatMessage(chatId, 'Hi', { onEvent: () => undefined, fetchImpl }),
    ).rejects.toBeInstanceOf(ApiClientError);
  });

  it('surfaces a non-2xx JSON error before any stream begins', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'generation_in_progress',
          message: 'Chat already has a generation in progress',
        }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      ),
    );

    const failure = await streamChatMessage(chatId, 'Hi', {
      onEvent: () => undefined,
      fetchImpl,
    }).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(ApiClientError);
    expect((failure as ApiClientError).status).toBe(409);
    expect((failure as ApiClientError).code).toBe('generation_in_progress');
  });

  it('propagates an abort raised mid-stream', async () => {
    const encoder = new TextEncoder();
    const controller = new AbortController();
    const fetchImpl = vi.fn().mockImplementation((_url, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(streamController) {
          streamController.enqueue(encoder.encode(frame({ type: 'delta', text: 'tick ' })));
          init?.signal?.addEventListener('abort', () => {
            streamController.error(new DOMException('Aborted', 'AbortError'));
          });
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    });
    const events: StreamEvent[] = [];

    const pending = streamChatMessage(chatId, 'Hi', {
      signal: controller.signal,
      onEvent: (event) => {
        events.push(event);
        controller.abort();
      },
      fetchImpl,
    });

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(events).toEqual([{ type: 'delta', text: 'tick ' }]);
  });
});
