import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  AgentChangesetDetail,
  AgentChangesetResolution,
  AgentChat,
  AgentChatDetail,
  BookSummary,
  Checkpoint,
  CustomAgent,
} from '@worldbookllm/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

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
async function boot(script: Array<() => Response>) {
  dataDir = mkdtempSync(join(tmpdir(), 'worldbookllm-review-'));
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
    payload: { providerConfig: { source: 'custom', model: 'local', baseUrl: 'http://p.test/v1' } },
  });
  const book = (
    await app.inject({ method: 'POST', url: '/api/books', payload: { title: 'Harbor' } })
  ).json<BookSummary>();
  return { app, book, requests, bookDir: join(dataDir, 'projects', book.slug) };
}

async function send(server: FastifyInstance, chatId: string, content: string) {
  return server.inject({
    method: 'POST',
    url: `/api/agent-chats/${chatId}/messages`,
    payload: { content },
  });
}

function lastUserContent(request: Record<string, unknown> | undefined): string {
  const messages = (request?.messages ?? []) as Array<{ role: string; content: unknown }>;
  return String(messages.filter((message) => message.role === 'user').at(-1)?.content);
}

describe('review mode', () => {
  it('stages a turn’s changes, applies one file as a checkpoint, and tells the model next turn', async () => {
    const { app, book, requests, bookDir } = await boot([
      () =>
        sse(
          toolCall('c1', 'run_story', {
            command: 'add',
            args: ['character', 'Mara Quill'],
            options: { role: 'protagonist' },
          }),
        ),
      () =>
        sse(
          toolCall('c2', 'edit_file', {
            path: 'characters/mara-quill.md',
            find: '## Appearance',
            replace: '## Appearance\n\nSalt-grey eyes.',
          }),
        ),
      () => sse(toolCall('c3', 'read_file', { path: 'characters/mara-quill.md' })),
      () => sse(text('I propose Mara Quill.')),
      () => sse(text('Noted.')),
    ]);
    const chat = (
      await app.inject({
        method: 'POST',
        url: `/api/books/${book.slug}/agent-chats`,
        payload: { reviewMode: true },
      })
    ).json<AgentChat>();
    expect(chat.reviewMode).toBe(true);

    const stream = await send(app, chat.id, 'Add Mara Quill.');
    expect(stream.body).toContain('event: changeset');
    expect(stream.body).not.toContain('event: checkpoint');
    // The real book is untouched, and nothing entered its history.
    expect(existsSync(join(bookDir, 'characters/mara-quill.md'))).toBe(false);
    const history = await app.inject({ method: 'GET', url: `/api/books/${book.slug}/checkpoints` });
    expect(history.json<Checkpoint[]>()).toEqual([]);
    // The staged copy is gone once the turn ends.
    expect(readdirSync(join(dataDir, 'staging'))).toEqual([]);
    // The agent saw its own staged edit.
    expect(requests[0]?.messages).toBeDefined();
    expect(String((requests[0]?.messages as Array<{ content: string }>)[0]?.content)).toContain(
      'Review mode is on',
    );

    const detail = (
      await app.inject({ method: 'GET', url: `/api/agent-chats/${chat.id}` })
    ).json<AgentChatDetail>();
    const readStep = detail.messages[1]?.steps[2]?.toolCalls[0];
    expect(readStep?.result).toContain('Salt-grey eyes.');
    const [changeset] = detail.changesets;
    expect(changeset?.messageId).toBe(detail.messages[1]?.id);
    // Registries are regenerated on apply, so they are not proposed.
    expect(changeset?.files).toEqual([
      { path: 'characters/mara-quill.md', change: 'created', status: 'pending' },
    ]);

    const diff = (
      await app.inject({ method: 'GET', url: `/api/agent-changesets/${changeset!.id}` })
    ).json<AgentChangesetDetail>();
    expect(diff.files[0]).toMatchObject({
      before: null,
      after: expect.stringContaining('Salt-grey'),
    });

    const applied = await app.inject({
      method: 'POST',
      url: `/api/agent-changesets/${changeset!.id}/apply`,
      payload: { paths: ['characters/mara-quill.md'] },
    });
    expect(applied.statusCode).toBe(200);
    const resolution = applied.json<AgentChangesetResolution>();
    expect(resolution.changeset.files[0]?.status).toBe('applied');
    expect(resolution.checkpoint).toMatchObject({ actor: 'agent' });
    expect(readFileSync(join(bookDir, 'characters/mara-quill.md'), 'utf8')).toContain(
      'Salt-grey eyes.',
    );
    expect(readFileSync(join(bookDir, 'characters/_index.md'), 'utf8')).toContain('mara-quill');

    // Nothing is left to apply.
    const again = await app.inject({
      method: 'POST',
      url: `/api/agent-changesets/${changeset!.id}/apply`,
      payload: {},
    });
    expect(again.statusCode).toBe(400);

    await send(app, chat.id, 'Thanks.');
    expect(lastUserContent(requests.at(-1))).toContain(
      "[The writer's review of your earlier proposed changes]\nApplied: characters/mara-quill.md.",
    );
    const after = (
      await app.inject({ method: 'GET', url: `/api/agent-chats/${chat.id}` })
    ).json<AgentChatDetail>();
    expect(after.messages[2]?.note).toContain('Applied: characters/mara-quill.md.');
    expect(after.messages[2]?.content).toBe('Thanks.');

    // Reported once: a third turn carries no note.
    await send(app, chat.id, 'Again.');
    expect(lastUserContent(requests.at(-1))).toBe('Again.');
  });

  it('refuses to apply over a file changed since the proposal, and skips it instead', async () => {
    const { app, book, bookDir } = await boot([
      () => sse(toolCall('c1', 'read_file', { path: 'story.md' })),
      () =>
        sse(
          toolCall('c2', 'write_file', {
            path: 'research/tides.md',
            content: '# Tides\n',
            expectedHash: null,
          }),
        ),
      () => sse(text('Proposed a note.')),
      () => sse(text('Understood.')),
    ]);
    await app.inject({
      method: 'PATCH',
      url: '/api/app-settings',
      payload: { agentReviewMode: true },
    });
    const chat = (
      await app.inject({ method: 'POST', url: `/api/books/${book.slug}/agent-chats`, payload: {} })
    ).json<AgentChat>();
    expect(chat.reviewMode).toBeNull();
    await send(app, chat.id, 'Write a tides note.');
    const [changeset] = (
      await app.inject({ method: 'GET', url: `/api/agent-chats/${chat.id}` })
    ).json<AgentChatDetail>().changesets;
    expect(changeset?.files).toEqual([
      { path: 'research/tides.md', change: 'created', status: 'pending' },
    ]);

    mkdirSync(join(bookDir, 'research'), { recursive: true });
    writeFileSync(join(bookDir, 'research/tides.md'), '# My own tides\n');
    const conflict = await app.inject({
      method: 'POST',
      url: `/api/agent-changesets/${changeset!.id}/apply`,
      payload: {},
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ error: 'file_changed' });
    expect(readFileSync(join(bookDir, 'research/tides.md'), 'utf8')).toBe('# My own tides\n');

    const skipped = await app.inject({
      method: 'POST',
      url: `/api/agent-changesets/${changeset!.id}/skip`,
      payload: {},
    });
    expect(skipped.json<AgentChangesetResolution>().changeset.files[0]?.status).toBe('skipped');

    await send(app, chat.id, 'Fine.');
    const detail = (
      await app.inject({ method: 'GET', url: `/api/agent-chats/${chat.id}` })
    ).json<AgentChatDetail>();
    expect(detail.messages[2]?.note).toContain('Skipped (not applied): research/tides.md.');
  });

  it('lets only one of a concurrent apply and skip decide a file', async () => {
    const { app, book, bookDir } = await boot([
      () =>
        sse(
          toolCall('c1', 'write_file', {
            path: 'notes/harbor.md',
            content: '# Harbor\n',
            expectedHash: null,
          }),
        ),
      () => sse(text('Proposed.')),
    ]);
    const chat = (
      await app.inject({
        method: 'POST',
        url: `/api/books/${book.slug}/agent-chats`,
        payload: { reviewMode: true },
      })
    ).json<AgentChat>();
    await send(app, chat.id, 'Write harbor notes.');
    const [changeset] = (
      await app.inject({ method: 'GET', url: `/api/agent-chats/${chat.id}` })
    ).json<AgentChatDetail>().changesets;

    const [applied, skipped] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/api/agent-changesets/${changeset!.id}/apply`,
        payload: {},
      }),
      app.inject({
        method: 'POST',
        url: `/api/agent-changesets/${changeset!.id}/skip`,
        payload: {},
      }),
    ]);
    expect(applied.statusCode).toBe(200);
    expect(skipped.statusCode).toBe(400);
    expect(applied.json<AgentChangesetResolution>().changeset.files[0]?.status).toBe('applied');
    expect(readFileSync(join(bookDir, 'notes/harbor.md'), 'utf8')).toBe('# Harbor\n');
  });

  it('keeps build output out of review mode', async () => {
    const { app, book } = await boot([
      () => sse(toolCall('c1', 'run_story', { command: 'build', args: [] })),
      () => sse(text('Could not build.')),
    ]);
    const chat = (
      await app.inject({
        method: 'POST',
        url: `/api/books/${book.slug}/agent-chats`,
        payload: { reviewMode: true },
      })
    ).json<AgentChat>();
    await send(app, chat.id, 'Build it.');
    const detail = (
      await app.inject({ method: 'GET', url: `/api/agent-chats/${chat.id}` })
    ).json<AgentChatDetail>();
    const call = detail.messages[1]?.steps[0]?.toolCalls[0];
    expect(call).toMatchObject({ ok: false });
    expect(call?.result).toContain('review mode does not keep');
    expect(detail.changesets).toEqual([]);
  });
});

describe('custom agents', () => {
  async function skill(server: FastifyInstance, name: string) {
    const created = await server.inject({
      method: 'POST',
      url: '/api/skills',
      payload: { name, description: `The ${name} skill.`, content: `# ${name}\n` },
    });
    expect(created.statusCode).toBe(201);
  }

  it('saves agents whose instructions and skills shape the chat’s turns', async () => {
    const { app, book, requests } = await boot([
      () => sse(toolCall('c1', 'activate_skill', { name: 'beta' })),
      () => sse(toolCall('c2', 'activate_skill', { name: 'alpha' })),
      () => sse(text('In verse.')),
    ]);
    await skill(app, 'alpha');
    await skill(app, 'beta');

    const missing = await app.inject({
      method: 'POST',
      url: '/api/agents',
      payload: { name: 'Verse', skills: ['gamma'] },
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toMatchObject({ error: 'invalid_request' });

    const created = await app.inject({
      method: 'POST',
      url: '/api/agents',
      payload: {
        name: 'Verse',
        description: 'Answers in verse.',
        instructions: 'Always answer in verse.',
        skills: ['alpha'],
      },
    });
    expect(created.statusCode).toBe(201);
    const agent = created.json<CustomAgent>();
    expect(agent).toMatchObject({ name: 'Verse', skills: ['alpha'] });
    expect((await app.inject({ method: 'GET', url: '/api/agents' })).json()).toHaveLength(1);

    const chat = (
      await app.inject({
        method: 'POST',
        url: `/api/books/${book.slug}/agent-chats`,
        payload: { agentId: agent.id },
      })
    ).json<AgentChat>();
    expect(chat.agentId).toBe(agent.id);
    await send(app, chat.id, 'Describe the harbor.');

    const system = String((requests[0]?.messages as Array<{ content: string }>)[0]?.content);
    expect(system).toContain('## Your role: Verse\nAlways answer in verse.');
    expect(system).toContain('- alpha: The alpha skill.');
    expect(system).not.toContain('- beta:');
    const detail = (
      await app.inject({ method: 'GET', url: `/api/agent-chats/${chat.id}` })
    ).json<AgentChatDetail>();
    const [refused, allowed] = detail.messages[1]!.steps.map((step) => step.toolCalls[0]);
    expect(refused).toMatchObject({ ok: false, result: expect.stringContaining('not available') });
    expect(allowed).toMatchObject({ ok: true });

    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/agents/${agent.id}`,
      payload: { name: 'Sonnet', skills: null },
    });
    expect(renamed.json<CustomAgent>()).toMatchObject({ name: 'Sonnet', skills: null });

    const deleted = await app.inject({ method: 'DELETE', url: `/api/agents/${agent.id}` });
    expect(deleted.statusCode).toBe(204);
    const orphan = (
      await app.inject({ method: 'GET', url: `/api/agent-chats/${chat.id}` })
    ).json<AgentChatDetail>();
    expect(orphan.agentId).toBeNull();
  });

  it('switches a chat’s agent and review mode, refusing unknown agents', async () => {
    const { app, book } = await boot([() => sse(text('ok'))]);
    const chat = (
      await app.inject({ method: 'POST', url: `/api/books/${book.slug}/agent-chats`, payload: {} })
    ).json<AgentChat>();
    const unknown = await app.inject({
      method: 'PATCH',
      url: `/api/agent-chats/${chat.id}`,
      payload: { agentId: '11111111-1111-4111-8111-111111111111' },
    });
    expect(unknown.statusCode).toBe(404);
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/agent-chats/${chat.id}`,
      payload: { reviewMode: false },
    });
    expect(patched.json<AgentChat>()).toMatchObject({ reviewMode: false, agentId: null });
  });
});
