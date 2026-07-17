import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export const STUB_MODEL_ID = 'stub-model';
export const STUB_MODEL_NAME = 'Stub Model';
export const STUB_REPLY = 'Stub reply: the word is brass.';
export const STUB_ORGANIZATION_REPLY = JSON.stringify({
  suggestions: [
    { index: 0, category: 'factions', tags: ['iron-compact', 'smugglers'] },
    { index: 1, category: 'places', tags: ['glass-marsh', 'tides'] },
  ],
});

// A message containing this marker switches the stream to a slow drip so a
// test can exercise stop/abort behavior before the stream finishes.
export const SLOW_MARKER = '[slow]';

export interface StubProvider {
  url: string;
  close(): Promise<void>;
}

interface ChatCompletionRequest {
  stream?: boolean;
  messages?: { content?: string }[];
}

/**
 * Minimal OpenAI-compatible provider for the `custom` source: a live model
 * list plus streaming and non-streaming chat completions. Authorization
 * headers are ignored — the custom source is keyless.
 */
export async function startStubProvider(): Promise<StubProvider> {
  const server = createServer((req, res) => {
    void route(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    server.close();
    throw new Error('Stub provider failed to bind a TCP port.');
  }
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = (req.url ?? '').split('?')[0] ?? '';
  if (req.method === 'GET' && path === '/v1/models') {
    // No top-level `message`/`error` keys: the provider package treats those
    // as a provider error even on a 200 response.
    json(res, 200, { data: [{ id: STUB_MODEL_ID, name: STUB_MODEL_NAME }] });
    return;
  }
  if (req.method === 'POST' && path === '/v1/chat/completions') {
    const body = await readJson(req);
    if (body === null) {
      json(res, 400, { error: { message: 'invalid JSON body' } });
      return;
    }
    if (body.stream === true) {
      streamCompletion(res, wantsSlowStream(body));
      return;
    }
    json(res, 200, {
      id: 'stub-completion',
      object: 'chat.completion',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: isOrganizationRequest(body) ? STUB_ORGANIZATION_REPLY : STUB_REPLY,
          },
          finish_reason: 'stop',
        },
      ],
    });
    return;
  }
  json(res, 404, { error: { message: `no stub route for ${req.method ?? ''} ${path}` } });
}

function isOrganizationRequest(body: ChatCompletionRequest): boolean {
  return JSON.stringify(body.messages ?? []).includes('Allowed categories: characters');
}

function wantsSlowStream(body: ChatCompletionRequest): boolean {
  return (body.messages ?? []).some((message) => message.content?.includes(SLOW_MARKER) === true);
}

function streamCompletion(res: ServerResponse, slow: boolean): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
  });
  const pieces = slow
    ? Array.from({ length: 150 }, (_, index) => `tick ${index} `)
    : STUB_REPLY.split(/(?<= )/);
  let index = 0;
  const timer = setInterval(
    () => {
      if (res.writableEnded || res.destroyed) {
        clearInterval(timer);
        return;
      }
      const piece = pieces[index];
      if (piece === undefined) {
        clearInterval(timer);
        res.end('data: [DONE]\n\n');
        return;
      }
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
      index += 1;
    },
    slow ? 200 : 20,
  );
  res.on('close', () => clearInterval(timer));
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<ChatCompletionRequest | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as ChatCompletionRequest;
  } catch {
    return null;
  }
}
