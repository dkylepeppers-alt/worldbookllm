import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export const STUB_MODEL_ID = 'stub-model';
const STUB_MODEL_NAME = 'Stub Model';
const STUB_REPLY = 'Stub reply: the word is brass.';

// Agent turns (requests that offer tools) follow a two-step script: the
// first step adds a character with run_story, and once a tool result is in
// the conversation the model answers without tools.
export const STUB_AGENT_CHARACTER = 'Ada Brass';
const STUB_AGENT_INTRO = `Adding ${STUB_AGENT_CHARACTER}.`;
export const STUB_AGENT_REPLY = `${STUB_AGENT_CHARACTER} is in the cast.`;

/** A custom agent's name, read back from its system-prompt role heading. */
function agentRole(body: ChatCompletionRequest): string | null {
  const system = body.messages?.find((message) => message.role === 'system')?.content ?? '';
  return /^## Your role: (.+)$/mu.exec(system)?.[1] ?? null;
}

// A message containing this marker makes the agent ask with ask_user instead;
// the writer's answer (sent with the ask_user note) gets STUB_ASK_REPLY.
export const ASK_MARKER = '[ask]';
export const STUB_ASK_OPTIONS = ['Tidal gothic', 'Harbor noir'] as const;
export const STUB_ASK_REPLY = 'Answer received.';

// A message containing this marker switches the stream to a slow drip so a
// test can exercise stop/abort behavior before the stream finishes.
export const SLOW_MARKER = '[slow]';

// Discovery's beat writer (ADR 0033): every beat is written at once with
// three different choices, the reader's own action is always accepted, and
// variables proposed from the premise are always this one.
export const STUB_BEAT_CHOICES = ['Climb to the lamp', 'Wait for the tide', 'Signal the ship'];
export const STUB_VARIABLE = {
  name: 'courage',
  initial: '0',
  meaning: 'How brave the keeper has been',
};

function isBeatWriterRequest(body: ChatCompletionRequest): boolean {
  const system = body.messages?.find((message) => message.role === 'system')?.content ?? '';
  return isAgentRequest(body) && system.startsWith('You are the beat writer in worldbookllm');
}

function toolNames(body: ChatCompletionRequest): string[] {
  return (body.tools ?? []).flatMap((entry) => {
    const name = (entry as { function?: { name?: unknown } }).function?.name;
    return typeof name === 'string' ? [name] : [];
  });
}

function call(name: string, args: unknown) {
  return {
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            {
              index: 0,
              id: `stub_${name}`,
              type: 'function',
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        },
      },
    ],
  };
}

const stubChoices = () =>
  STUB_BEAT_CHOICES.map((text, index) => ({
    text,
    intent: ['ascend', 'patience', 'help'][index],
    consequence: ['sees the sea', 'loses time', 'is seen'][index],
    leads_to: 'new',
  }));

/** One beat-writer step: write the beat (or choices, or the reader's action) in one call. */
function beatWriterStep(body: ChatCompletionRequest): unknown[] {
  const tools = toolNames(body);
  const task = body.messages?.find((message) => message.role === 'user')?.content ?? '';
  if (tools.includes('accept_action')) {
    const action = /typed their own action:\n> (.+)/u.exec(task)?.[1]?.trim() ?? 'Something else';
    const text = action.charAt(0).toUpperCase() + action.slice(1);
    return [
      call('accept_action', {
        choice: { text, intent: 'the reader’s own', consequence: 'something new' },
        beat: {
          title: text,
          summary: `The keeper does it: ${action}.`,
          ink: `You ${action}. The light turns on the water.`,
          ending: true,
          choices: [],
        },
      }),
    ];
  }
  if (tools.includes('write_choices')) return [call('write_choices', { choices: stubChoices() })];
  const chosen = /when the reader chooses "([^"]+)"/u.exec(task)?.[1];
  const title = chosen ?? 'The Rock';
  return [
    call('write_beat', {
      title,
      summary: `What happens: ${title}.`,
      ink:
        chosen === undefined
          ? 'Wind on the rock. The lamp is dark.'
          : `You chose to ${chosen.toLowerCase()}. The fog thins.`,
      ending: false,
      choices: stubChoices(),
    }),
  ];
}

function streamChunks(res: ServerResponse, chunks: unknown[]): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
  });
  for (const chunk of chunks) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  res.end('data: [DONE]\n\n');
}

export interface StubProvider {
  url: string;
  close(): Promise<void>;
}

interface ChatCompletionRequest {
  stream?: boolean;
  messages?: { role?: string; content?: string | null }[];
  tools?: unknown[];
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
    if (body.stream === true && isBeatWriterRequest(body)) {
      streamChunks(res, beatWriterStep(body));
      return;
    }
    const prompt = body.messages?.at(-1)?.content ?? '';
    if (body.stream === true && prompt.includes('Reply with JSON only, no prose')) {
      // The beat writer's review pass: every set of choices follows the rules.
      streamChunks(res, [{ choices: [{ index: 0, delta: { content: '{"pass": true}' } }] }]);
      return;
    }
    if (body.stream === true && prompt.includes('Reply with JSON only: {"variables"')) {
      streamChunks(res, [
        {
          choices: [
            {
              index: 0,
              delta: { content: JSON.stringify({ variables: [STUB_VARIABLE] }) },
            },
          ],
        },
      ]);
      return;
    }
    if (body.stream === true && isAgentRequest(body) && !wantsSlowStream(body)) {
      streamAgentStep(res, body);
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
            content: STUB_REPLY,
          },
          finish_reason: 'stop',
        },
      ],
    });
    return;
  }
  json(res, 404, { error: { message: `no stub route for ${req.method ?? ''} ${path}` } });
}

function wantsSlowStream(body: ChatCompletionRequest): boolean {
  return (body.messages ?? []).some((message) => message.content?.includes(SLOW_MARKER) === true);
}

function isAgentRequest(body: ChatCompletionRequest): boolean {
  return Array.isArray(body.tools) && body.tools.length > 0;
}

/** One agent step: a run_story call first, then a plain answer once a tool has replied. */
function streamAgentStep(res: ServerResponse, body: ChatCompletionRequest): void {
  const messages = body.messages ?? [];
  const lastUser = messages.map((message) => message.role).lastIndexOf('user');
  const toolReplied = messages.slice(lastUser + 1).some((message) => message.role === 'tool');
  const role = agentRole(body);
  const reply = role === null ? STUB_AGENT_REPLY : `${STUB_AGENT_REPLY} Speaking as ${role}.`;
  const userText = messages[lastUser]?.content ?? '';
  const chunks = userText.includes('answers your ask_user call')
    ? [{ choices: [{ index: 0, delta: { content: STUB_ASK_REPLY } }] }]
    : userText.includes(ASK_MARKER) && !toolReplied
      ? [
          {
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'stub_ask_1',
                      type: 'function',
                      function: {
                        name: 'ask_user',
                        arguments: JSON.stringify({
                          questions: [
                            {
                              header: 'Mood',
                              question: 'Which mood should the premise have?',
                              options: STUB_ASK_OPTIONS.map((label) => ({ label })),
                            },
                          ],
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          },
        ]
      : toolReplied
        ? [{ choices: [{ index: 0, delta: { content: reply } }] }]
        : [
            { choices: [{ index: 0, delta: { content: STUB_AGENT_INTRO } }] },
            {
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: 'stub_call_1',
                        type: 'function',
                        function: {
                          name: 'run_story',
                          arguments: JSON.stringify({
                            command: 'add',
                            args: ['character', STUB_AGENT_CHARACTER],
                          }),
                        },
                      },
                    ],
                  },
                },
              ],
            },
          ];
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
  });
  for (const chunk of chunks) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  res.end('data: [DONE]\n\n');
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
