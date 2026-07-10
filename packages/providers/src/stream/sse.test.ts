import { describe, expect, it } from 'vitest';

import { parseSseStream } from './sse.js';

function streamFromChunks(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>) {
  const events = [];
  for await (const event of parseSseStream(stream)) {
    events.push(event);
  }
  return events;
}

describe('parseSseStream', () => {
  it('parses fields split across chunks with CRLF framing', async () => {
    const events = await collect(
      streamFromChunks('event: mes', 'sage\r\nid: 42\r\ndata: {"text":"br', 'ass"}\r\n\r\n'),
    );

    expect(events).toEqual([{ event: 'message', id: '42', data: '{"text":"brass"}' }]);
  });

  it('joins multiline data and ignores comments', async () => {
    const events = await collect(
      streamFromChunks(': keepalive\nretry: 2500\ndata: first\ndata: second\n\n'),
    );

    expect(events).toEqual([{ data: 'first\nsecond', retry: 2500 }]);
  });

  it('accepts carriage-return-only framing', async () => {
    const events = await collect(streamFromChunks('data: first\r\rdata: second\r\r'));

    expect(events).toEqual([{ data: 'first' }, { data: 'second' }]);
  });

  it('flushes the final event when the stream ends without a blank line', async () => {
    const events = await collect(streamFromChunks('data: final'));

    expect(events).toEqual([{ data: 'final' }]);
  });

  it('preserves a done sentinel for the caller', async () => {
    const events = await collect(streamFromChunks('data: [DONE]\n\n'));

    expect(events).toEqual([{ data: '[DONE]' }]);
  });

  it('decodes a multibyte character split between byte chunks', async () => {
    const bytes = new TextEncoder().encode('data: moon 🌕\n\n');
    const splitAt = bytes.indexOf(0xf0) + 2;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, splitAt));
        controller.enqueue(bytes.slice(splitAt));
        controller.close();
      },
    });

    await expect(collect(stream)).resolves.toEqual([{ data: 'moon 🌕' }]);
  });

  it('ignores invalid retry values and events with no data field', async () => {
    const events = await collect(
      streamFromChunks('event: ping\nretry: later\n\ndata: response\n\n'),
    );

    expect(events).toEqual([{ data: 'response' }]);
  });

  it('cancels the underlying stream when the consumer stops early', async () => {
    const encoder = new TextEncoder();
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      },
      cancel() {
        cancelled = true;
      },
    });

    for await (const event of parseSseStream(stream)) {
      expect(event.data).toBe('[DONE]');
      break;
    }

    expect(cancelled).toBe(true);
  });
});
