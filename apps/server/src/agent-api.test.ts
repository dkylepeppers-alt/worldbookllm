import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AgentChat, AgentChatDetail, BookSummary, Checkpoint } from '@worldbookllm/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { AGENT_MAX_STEPS } from './agent/agent-service.js';
import { buildApp } from './app.js';

let app: FastifyInstance | undefined;
let dataDir: string;

afterEach(async () => {
  await app?.close();
  app = undefined;
  rmSync(dataDir, { recursive: true, force: true });
});

function sse(...payloads: unknown[]): Response {
  return new Response(
    `${payloads.map((payload) => `data: ${JSON.stringify(payload)}\n\n`).join('')}data: [DONE]\n\n`,
  );
}

function toolCall(id: string, name: string, args: unknown) {
  return {
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            { index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } },
          ],
        },
      },
    ],
  };
}

function text(content: string) {
  return { choices: [{ index: 0, delta: { content } }] };
}

/** Boots the app with a scripted model: each provider request gets the next response. */
async function boot(script: Array<() => Response>, source = 'custom') {
  dataDir = mkdtempSync(join(tmpdir(), 'worldbookllm-agent-'));
  const requests: Array<Record<string, unknown>> = [];
  let turn = 0;
  app = buildApp({
    dataDir,
    logger: false,
    fetchImpl: async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      const next = script[Math.min(turn, script.length - 1)];
      turn += 1;
      return Promise.resolve(next ? next() : sse(text('…')));
    },
  });
  await app.inject({
    method: 'PATCH',
    url: '/api/app-settings',
    payload: {
      providerConfig: { source, model: 'local', baseUrl: 'http://provider.test/v1' },
    },
  });
  const book = (
    await app.inject({ method: 'POST', url: '/api/books', payload: { title: 'Harbor' } })
  ).json<BookSummary>();
  const chat = (
    await app.inject({ method: 'POST', url: `/api/books/${book.slug}/agent-chats`, payload: {} })
  ).json<AgentChat>();
  return { app, book, chat, requests };
}

describe('agent turns', () => {
  it('runs tools, streams events, records every step, and lands one undoable checkpoint', async () => {
    const { app, book, chat, requests } = await boot([
      () =>
        sse(
          text('Adding Mara.'),
          toolCall('call_1', 'run_story', {
            command: 'add',
            args: ['character', 'Mara Quill'],
            options: { role: 'protagonist' },
          }),
        ),
      () =>
        sse(
          toolCall('call_2', 'edit_file', {
            path: 'characters/mara-quill.md',
            find: '## Appearance',
            replace: '## Appearance\n\nSalt-grey eyes.',
          }),
        ),
      () => sse(text('Mara Quill is in the cast.')),
    ]);

    const stream = await app.inject({
      method: 'POST',
      url: `/api/agent-chats/${chat.id}/messages`,
      payload: { content: 'Add Mara Quill, a lighthouse keeper.' },
    });
    expect(stream.statusCode).toBe(200);
    for (const event of ['step', 'delta', 'tool_call', 'tool_result', 'checkpoint', 'done']) {
      expect(stream.body).toContain(`event: ${event}`);
    }

    const character = readFileSync(
      join(dataDir, 'projects', book.slug, 'characters/mara-quill.md'),
      'utf8',
    );
    expect(character).toContain('role: protagonist');
    expect(character).toContain('Salt-grey eyes.');

    // The model saw the tools, then its own call and the tool's result.
    expect(requests).toHaveLength(3);
    expect(
      (requests[0]?.tools as Array<{ function: { name: string } }>).map(
        (tool) => tool.function.name,
      ),
    ).toContain('run_story');
    expect(requests[0]?.tool_choice).toBe('auto');
    const secondMessages = requests[1]?.messages as Array<Record<string, unknown>>;
    expect(secondMessages.at(-2)).toMatchObject({
      role: 'assistant',
      content: 'Adding Mara.',
      tool_calls: [{ id: 'call_1', function: { name: 'run_story' } }],
    });
    expect(secondMessages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'call_1' });
    expect(String(secondMessages.at(-1)?.content)).toContain('exit code 0');
    expect(String((secondMessages[0] as { content: string }).content)).toContain('Harbor');

    const detail = (
      await app.inject({ method: 'GET', url: `/api/agent-chats/${chat.id}` })
    ).json<AgentChatDetail>();
    const [user, assistant] = detail.messages;
    expect(user).toMatchObject({ role: 'user', content: 'Add Mara Quill, a lighthouse keeper.' });
    expect(assistant).toMatchObject({
      role: 'assistant',
      status: 'complete',
      content: 'Adding Mara.\n\nMara Quill is in the cast.',
    });
    expect(
      assistant?.steps.map((step) => step.toolCalls.map((call) => [call.name, call.ok])),
    ).toEqual([[['run_story', true]], [['edit_file', true]], []]);
    expect(assistant?.steps[0]?.requestBody).toHaveProperty('tools');
    expect(detail.title).toBe('Add Mara Quill, a lighthouse keeper.');

    const checkpoints = (
      await app.inject({ method: 'GET', url: `/api/books/${book.slug}/checkpoints` })
    ).json<Checkpoint[]>();
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0]).toMatchObject({
      id: assistant?.checkpointId,
      actor: 'agent',
      label: 'Agent: Add Mara Quill, a lighthouse keeper.',
    });
    expect(checkpoints[0]?.files).toEqual(
      expect.arrayContaining([
        { path: 'characters/mara-quill.md', change: 'created' },
        { path: 'characters/_index.md', change: 'modified' },
      ]),
    );

    const undo = await app.inject({
      method: 'POST',
      url: `/api/books/${book.slug}/checkpoints/${assistant?.checkpointId}/undo`,
    });
    expect(undo.statusCode).toBe(200);
    expect(existsSync(join(dataDir, 'projects', book.slug, 'characters/mara-quill.md'))).toBe(
      false,
    );
  });

  it('reports bad tool calls to the model instead of failing the turn', async () => {
    const { app, chat, requests } = await boot([
      () => sse(toolCall('call_1', 'read_file', { path: '../../secrets.json' })),
      () => sse(toolCall('call_2', 'run_story', { command: 'init', args: ['Other'] })),
      () => sse(toolCall('call_3', 'no_such_tool', {})),
      () => sse(text('Done.')),
    ]);
    const stream = await app.inject({
      method: 'POST',
      url: `/api/agent-chats/${chat.id}/messages`,
      payload: { content: 'Try things.' },
    });
    expect(stream.body).toContain('event: done');
    const results = requests
      .slice(1)
      .map((request) => (request.messages as Array<{ content: unknown }>).at(-1)?.content);
    // Reads go through the book's index, which only ever holds files inside the book.
    expect(results[0]).toBe('Error: ../../secrets.json was not found in harbor');
    expect(results[1]).toBe('Error: story init is not available to the agent.');
    expect(results[2]).toBe('Error: Unknown tool: no_such_tool');
  });

  it(`stops after ${AGENT_MAX_STEPS} steps`, async () => {
    const { app, chat, requests } = await boot([() => sse(toolCall('call_x', 'list_files', {}))]);
    await app.inject({
      method: 'POST',
      url: `/api/agent-chats/${chat.id}/messages`,
      payload: { content: 'Loop forever.' },
    });
    expect(requests).toHaveLength(AGENT_MAX_STEPS);
    const detail = (
      await app.inject({ method: 'GET', url: `/api/agent-chats/${chat.id}` })
    ).json<AgentChatDetail>();
    expect(detail.messages[1]?.content).toBe(`(Stopped after ${AGENT_MAX_STEPS} steps.)`);
    expect(detail.messages[1]?.status).toBe('complete');
  });

  it('refuses providers without tool calling before starting a turn', async () => {
    const { app, chat } = await boot([() => sse(text('unused'))], 'perplexity');
    const response = await app.inject({
      method: 'POST',
      url: `/api/agent-chats/${chat.id}/messages`,
      payload: { content: 'Hello' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ message: string }>().message).toMatch(/tool calling/u);
  });
});

describe('story-skills install', () => {
  it('installs the pinned skills with their references, and the agent can load them', async () => {
    const { app, chat, requests } = await boot([
      () => sse(toolCall('call_1', 'activate_skill', { name: 'worldbuilding' })),
      () =>
        sse(
          toolCall('call_2', 'read_skill_file', {
            name: 'worldbuilding',
            path: 'references/location-template.md',
          }),
        ),
      () => sse(text('Loaded.')),
    ]);
    const install = await app.inject({ method: 'POST', url: '/api/skills-story/install' });
    expect(install.statusCode).toBe(201);
    const result = install.json<{ installed: Array<{ name: string }>; skipped: string[] }>();
    expect(result.installed).toHaveLength(23);
    expect(result.installed.map((skill) => skill.name)).toContain('story-maintenance');
    expect(existsSync(join(dataDir, 'skills/worldbuilding/references/location-template.md'))).toBe(
      true,
    );

    const again = await app.inject({ method: 'POST', url: '/api/skills-story/install' });
    expect(again.json<{ installed: unknown[]; skipped: string[] }>()).toMatchObject({
      installed: [],
    });

    await app.inject({
      method: 'POST',
      url: `/api/agent-chats/${chat.id}/messages`,
      payload: { content: 'Design a location.' },
    });
    const system = String((requests[0]?.messages as Array<{ content: unknown }>)[0]?.content);
    expect(system).toContain('- worldbuilding: This skill should be used when');
    const activated = String(
      (requests[1]?.messages as Array<{ content: unknown }>).at(-1)?.content,
    );
    expect(activated).toContain('# Worldbuilding');
    expect(activated).toContain('references/location-template.md');
    const reference = String(
      (requests[2]?.messages as Array<{ content: unknown }>).at(-1)?.content,
    );
    expect(reference.length).toBeGreaterThan(100);
    expect(reference).not.toMatch(/^Error/u);
  });
});
