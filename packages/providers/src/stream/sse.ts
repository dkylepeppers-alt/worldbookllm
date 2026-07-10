export interface SseEvent {
  data: string;
  event?: string;
  id?: string;
  retry?: number;
}

interface EventState {
  data: string[];
  hasData: boolean;
  event?: string;
  id?: string;
  retry?: number;
}

function newEventState(): EventState {
  return { data: [], hasData: false };
}

function eventFromState(state: EventState): SseEvent | undefined {
  if (!state.hasData) {
    return undefined;
  }
  return {
    data: state.data.join('\n'),
    ...(state.event !== undefined ? { event: state.event } : {}),
    ...(state.id !== undefined ? { id: state.id } : {}),
    ...(state.retry !== undefined ? { retry: state.retry } : {}),
  };
}

function applyField(state: EventState, line: string): void {
  if (line.startsWith(':')) {
    return;
  }

  const colon = line.indexOf(':');
  const field = colon === -1 ? line : line.slice(0, colon);
  let value = colon === -1 ? '' : line.slice(colon + 1);
  if (value.startsWith(' ')) {
    value = value.slice(1);
  }

  switch (field) {
    case 'data':
      state.hasData = true;
      state.data.push(value);
      break;
    case 'event':
      state.event = value;
      break;
    case 'id':
      if (!value.includes('\0')) {
        state.id = value;
      }
      break;
    case 'retry':
      if (/^\d+$/.test(value)) {
        state.retry = Number(value);
      }
      break;
  }
}

function takeLine(
  buffer: string,
  streamEnded: boolean,
): { line: string; rest: string } | undefined {
  const delimiter = buffer.search(/[\r\n]/);
  if (delimiter === -1) {
    return undefined;
  }

  const isCarriageReturn = buffer[delimiter] === '\r';
  if (isCarriageReturn && delimiter === buffer.length - 1 && !streamEnded) {
    return undefined;
  }
  const delimiterLength = isCarriageReturn && buffer[delimiter + 1] === '\n' ? 2 : 1;
  return {
    line: buffer.slice(0, delimiter),
    rest: buffer.slice(delimiter + delimiterLength),
  };
}

/** Parse an SSE byte stream without assuming provider chunk boundaries. */
export async function* parseSseStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<SseEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let state = newEventState();
  let reachedEof = false;

  const processLine = (line: string): SseEvent | undefined => {
    if (line === '') {
      const event = eventFromState(state);
      state = newEventState();
      return event;
    }
    applyField(state, line);
    return undefined;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });

      let parsedLine = takeLine(buffer, done);
      while (parsedLine) {
        buffer = parsedLine.rest;
        const event = processLine(parsedLine.line);
        if (event) {
          yield event;
        }
        parsedLine = takeLine(buffer, done);
      }

      if (done) {
        reachedEof = true;
        if (buffer.length > 0) {
          const event = processLine(buffer);
          if (event) {
            yield event;
          }
        }
        const finalEvent = processLine('');
        if (finalEvent) {
          yield finalEvent;
        }
        return;
      }
    }
  } finally {
    if (!reachedEof) {
      await reader.cancel().catch(() => undefined);
    }
    reader.releaseLock();
  }
}
