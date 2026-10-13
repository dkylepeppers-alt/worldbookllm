import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BookSummary, Checkpoint, DiscoverState } from '@worldbookllm/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import { parseFrontmatter } from './story/book-index.js';
import { inkSection } from './story/interactive/format.js';

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

const PASS = () => sse(text('{"pass": true}'));

function choice(text: string, intent: string, extra: Record<string, unknown> = {}) {
  return { text, intent, consequence: `${intent} has a cost`, leads_to: 'new', ...extra };
}

const THREE = [
  choice('Open the letter', 'curiosity'),
  choice('Burn it unread', 'refusal'),
  choice('Hand it back to the keeper', 'deference'),
];

/** Boots the app with a scripted model and an empty interactive book. */
async function boot(script: Array<() => Response>) {
  dataDir = mkdtempSync(join(tmpdir(), 'worldbookllm-discover-'));
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
      providerConfig: { source: 'custom', model: 'local', baseUrl: 'http://provider.test/v1' },
    },
  });
  const book = (
    await app.inject({ method: 'POST', url: '/api/books', payload: { title: 'Gull Rock' } })
  ).json<BookSummary>();
  const { token } = await app.services.books.inkConversion(book.slug);
  await app.services.books.convertToInk(book.slug, { token });
  return { app, slug: book.slug, requests };
}

async function setUp(
  app: FastifyInstance,
  slug: string,
  options: { mode: 'lead' | 'cowrite'; opening: string | null },
): Promise<DiscoverState> {
  const response = await app.inject({
    method: 'PUT',
    url: `/api/books/${slug}/discover/setup`,
    payload: {
      setup: {
        mode: options.mode,
        lookahead: 1,
        choices: 3,
        beatLength: 'scene',
        rejoin: 'sometimes',
        endings: '',
        kernel: 'A lighthouse keeper receives a letter she cannot read.',
        shape: 'Cold and short.',
      },
      rules: '1. Different intents.\n2. Every choice matters.',
      variables: [{ name: 'trust', initial: '0', meaning: 'How much the keeper trusts you' }],
      opening: options.opening,
    },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<DiscoverState>();
}

async function settle(app: FastifyInstance, slug: string): Promise<DiscoverState> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const state = (
      await app.inject({ method: 'GET', url: `/api/books/${slug}/discover` })
    ).json<DiscoverState>();
    if (!state.jobs.some((job) => job.status === 'queued' || job.status === 'running'))
      return state;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('discovery jobs did not settle');
}

function chapter(app: FastifyInstance, slug: string, id: string) {
  return app.services.books.readFile(slug, `chapters/${id}.md`).content;
}

describe('discovering an interactive book', () => {
  it('sets a book up, writes the opening after sending back choices that break the rules, and seeds each branch', async () => {
    const { app, slug, requests } = await boot([
      () =>
        sse(
          toolCall('first', 'write_beat', {
            title: 'The Letter',
            summary: 'The keeper hands over a letter.',
            ink: 'The keeper hands you a letter sealed in black wax.',
            ending: false,
            choices: [
              choice('Ask about the letter', 'questions'),
              choice('Ask what the letter says', 'questions'),
              choice('Spend the gold', 'greed', { effects: ['gold -= 1'] }),
            ],
          }),
        ),
      () =>
        sse(
          toolCall('second', 'write_beat', {
            title: 'The Letter',
            summary: 'The keeper hands over a letter.',
            ink: 'The keeper hands you a letter sealed in black wax.\n{trust > 0: She almost smiles.}',
            ending: false,
            choices: [
              ...THREE.slice(0, 2),
              choice('Walk out into the storm', 'flight', {
                leads_to: 'end',
                effects: ['trust -= 1'],
              }),
            ],
          }),
        ),
      PASS,
    ]);
    const state = await setUp(app, slug, { mode: 'cowrite', opening: null });
    expect(state.setup?.kernel).toBe('A lighthouse keeper receives a letter she cannot read.');
    expect(state.variables).toEqual([
      { name: 'trust', initial: '0', meaning: 'How much the keeper trusts you' },
    ]);
    expect(state.openThreads.map((thread) => thread.chapterId)).toEqual(['chapter-01']);
    expect(app.services.books.readFile(slug, 'story.md').content).toContain(
      '## Story Kernel\n\nA lighthouse keeper receives a letter she cannot read.',
    );
    expect(
      app.services.books.readFile(slug, 'adaptations/interactive/choice-rules.md').content,
    ).toContain('2. Every choice matters.');
    // Co-write mode writes nothing on its own.
    expect(state.jobs).toEqual([]);

    const write = await app.inject({
      method: 'POST',
      url: `/api/books/${slug}/discover/write`,
      payload: { chapterId: 'chapter-01', position: null },
    });
    expect(write.statusCode, write.body).toBe(200);
    const after = await settle(app, slug);
    expect(after.jobs).toEqual([]);

    // The first set came back with what was wrong.
    const feedback = JSON.stringify(requests[1]);
    expect(feedback).toContain('nearly the same action');
    expect(feedback).toContain('gold is not a declared variable');
    // The second went to review, then was written.
    expect(JSON.stringify(requests[2])).toContain('Reply with JSON only');

    const opening = chapter(app, slug, 'chapter-01');
    expect(parseFrontmatter(opening).frontmatter).toMatchObject({
      title: 'The Letter',
      discover: 'written',
    });
    expect(inkSection(opening, 'chapter').ink).toContain(
      '* [Open the letter] -> chapter_02\n* [Burn it unread] -> chapter_03\n* [Walk out into the storm]\n    ~ trust -= 1\n    -> END\n',
    );
    expect(after.openThreads.map((thread) => [thread.chapterId, thread.playPath])).toEqual([
      ['chapter-02', [0]],
      ['chapter-03', [1]],
    ]);
    const checkpoints = (
      await app.inject({ method: 'GET', url: `/api/books/${slug}/checkpoints` })
    ).json<Checkpoint[]>();
    expect(checkpoints[0]).toMatchObject({ label: 'Discover: write The Letter', actor: 'agent' });
    // The story still plays, seeds and all.
    expect((await app.inject({ method: 'GET', url: `/api/books/${slug}/play` })).statusCode).toBe(
      200,
    );
    const build = await app.inject({
      method: 'POST',
      url: `/api/books/${slug}/builds`,
      payload: { format: 'ink' },
    });
    expect(build.json<{ output: string }>().output).toContain(
      '2 branches are not written yet, so they end the story: Open the letter, Burn it unread.',
    );
  }, 30_000);

  it('leads: writes the choices after the writer’s own opening, then the beat after each one', async () => {
    const ending = (title: string) => () =>
      sse(
        toolCall(title, 'write_beat', {
          title,
          summary: '',
          ink: `${title}.`,
          ending: true,
          choices: [],
        }),
      );
    const { app, slug } = await boot([
      () => sse(toolCall('choices', 'write_choices', { choices: THREE })),
      PASS,
      ending('Inside the letter'),
      ending('Ashes'),
      ending('The keeper takes it'),
    ]);
    await setUp(app, slug, {
      mode: 'lead',
      opening: '# The Rock\n\nWind. The keeper waits at the door.',
    });
    const state = await settle(app, slug);
    const opening = chapter(app, slug, 'chapter-01');
    // The writer's opening is theirs: kept as written, never counted as the beat writer's.
    expect(opening).toContain(
      'Wind. The keeper waits at the door.\n\n* [Open the letter] -> chapter_02',
    );
    expect(opening).toContain(
      '- **Open the letter** (a new beat): curiosity — curiosity has a cost',
    );
    expect(
      state.beats.map((beat) => [beat.chapterId, beat.state, beat.ending, beat.edited]),
    ).toEqual([
      ['chapter-01', 'written', false, true],
      ['chapter-02', 'written', true, false],
      ['chapter-03', 'written', true, false],
      ['chapter-04', 'written', true, false],
    ]);
    expect(state.openThreads).toEqual([]);
  }, 30_000);

  it('turns the reader’s own action into a real choice, or declines it with a reason', async () => {
    const { app, slug } = await boot([
      () =>
        sse(
          toolCall('decline', 'decline_action', {
            reason: 'There is no boat on the rock.',
            suggestion: 'Signal the passing ship',
          }),
        ),
      () =>
        sse(
          toolCall('accept', 'accept_action', {
            choice: {
              text: 'Read the letter aloud to her',
              intent: 'honesty',
              consequence: 'she hears it too',
              effects: ['trust += 1'],
            },
            beat: {
              title: 'Aloud',
              summary: 'You read it to her.',
              ink: 'You read it aloud.',
              ending: true,
              choices: [],
            },
          }),
        ),
    ]);
    const files = app.services.books;
    await setUp(app, slug, { mode: 'cowrite', opening: 'The keeper waits.' });
    const first = files.readFile(slug, 'chapters/chapter-01.md');
    await files.writeFile(slug, 'chapters/chapter-01.md', {
      content: first.content.replace(
        '-> END',
        '* [Open the letter] -> END\n* [Burn it] -> END\n* [Wait] -> END',
      ),
      expectedHash: first.hash,
    });
    const position = { from: null, set: {}, seed: 1, path: [] };

    await app.inject({
      method: 'POST',
      url: `/api/books/${slug}/discover/something-else`,
      payload: { position, action: 'Row a boat to the mainland' },
    });
    let state = await settle(app, slug);
    expect(state.jobs[0]).toMatchObject({
      kind: 'something-else',
      status: 'done',
      outcome: {
        accepted: false,
        reason: 'There is no boat on the rock.',
        suggestion: 'Signal the passing ship',
      },
    });

    await app.inject({
      method: 'POST',
      url: `/api/books/${slug}/discover/something-else`,
      payload: { position, action: 'read it to her' },
    });
    state = await settle(app, slug);
    expect(state.jobs.at(-1)).toMatchObject({
      status: 'done',
      outcome: { accepted: true, chapterId: 'chapter-01', choice: 3 },
    });
    expect(inkSection(chapter(app, slug, 'chapter-01'), 'chapter').ink).toContain(
      '* [Wait] -> END\n* [Read the letter aloud to her]\n    ~ trust += 1\n    -> chapter_02\n',
    );
    expect(chapter(app, slug, 'chapter-02')).toContain('You read it aloud.');
  }, 30_000);

  it('rewrites stale beats no one read, lists read ones for review, and records variable proposals', async () => {
    const beat = (title: string) => () =>
      sse(
        toolCall(title, 'write_beat', {
          title,
          summary: '',
          ink: `${title}.`,
          ending: true,
          choices: [],
        }),
      );
    const { app, slug } = await boot([
      () => sse(toolCall('choices', 'write_choices', { choices: THREE })),
      PASS,
      () =>
        sse(
          toolCall('propose', 'propose_variable', {
            name: 'read_letter',
            initial: 'false',
            meaning: 'Whether you read the letter',
            reason: 'Later beats change if you know.',
          }),
        ),
      beat('Inside'),
      beat('Ashes'),
      beat('Returned'),
      beat('Ashes again'),
      beat('Returned again'),
    ]);
    await setUp(app, slug, { mode: 'lead', opening: 'Wind.' });
    let state = await settle(app, slug);
    expect(state.proposals.map((proposal) => proposal.variable.name)).toEqual(['read_letter']);

    // The reader opens the letter: chapter-02 is read now.
    await app.inject({
      method: 'POST',
      url: `/api/books/${slug}/discover/position`,
      payload: { position: { from: null, set: {}, seed: 1, path: [0] } },
    });
    await settle(app, slug);
    await app.inject({
      method: 'POST',
      url: `/api/books/${slug}/discover/position`,
      payload: { position: { from: null, set: {}, seed: 1, path: [] } },
    });

    // The writer changes the opening.
    const files = app.services.books;
    const first = files.readFile(slug, 'chapters/chapter-01.md');
    await files.writeFile(slug, 'chapters/chapter-01.md', {
      content: first.content.replace('Wind.', 'Wind, and rain.'),
      expectedHash: first.hash,
    });
    await app.inject({
      method: 'POST',
      url: `/api/books/${slug}/discover/position`,
      payload: { position: { from: null, set: {}, seed: 1, path: [] } },
    });
    state = await settle(app, slug);
    // The two no one read were rewritten from the opening as it is now.
    expect(chapter(app, slug, 'chapter-03')).toContain('Ashes again.');
    expect(chapter(app, slug, 'chapter-04')).toContain('Returned again.');
    // The one the reader read waits for the writer.
    expect(state.needsReview.map((entry) => entry.chapterId)).toEqual(['chapter-02']);
    expect(chapter(app, slug, 'chapter-02')).toContain('Inside.');

    state = (
      await app.inject({
        method: 'POST',
        url: `/api/books/${slug}/discover/chapters/chapter-02/reviewed`,
      })
    ).json<DiscoverState>();
    expect(state.needsReview).toEqual([]);

    state = (
      await app.inject({
        method: 'POST',
        url: `/api/books/${slug}/discover/proposals/${state.proposals[0]!.id}`,
        payload: { approve: true },
      })
    ).json<DiscoverState>();
    expect(state.proposals).toEqual([]);
    expect(state.variables.map((variable) => variable.name)).toEqual(['trust', 'read_letter']);
  }, 30_000);

  it('drafts three different beats for a seed and writes the one the writer picks', async () => {
    const draft = (title: string) => () =>
      sse(
        toolCall(title, 'write_beat', {
          title,
          summary: `${title} happens.`,
          ink: `${title}.`,
          ending: true,
          choices: [],
        }),
      );
    const { app, slug, requests } = await boot([draft('Fog'), draft('Fire'), draft('Flood')]);
    await setUp(app, slug, { mode: 'cowrite', opening: null });
    await app.inject({
      method: 'POST',
      url: `/api/books/${slug}/discover/drafts`,
      payload: { chapterId: 'chapter-01', position: null, direction: 'Something strange at sea' },
    });
    const state = await settle(app, slug);
    const job = state.jobs[0]!;
    expect(job).toMatchObject({ kind: 'drafts', status: 'done' });
    expect(job.drafts.map((entry) => [entry.title, entry.prose, entry.ending])).toEqual([
      ['Fog', 'Fog.', true],
      ['Fire', 'Fire.', true],
      ['Flood', 'Flood.', true],
    ]);
    // Each later draft is told where the earlier ones went.
    expect(JSON.stringify(requests[2])).toContain('- Fog: Fog happens.');
    expect(JSON.stringify(requests[2])).toContain('- Fire: Fire happens.');
    expect(JSON.stringify(requests[0])).toContain('Something strange at sea');
    // Nothing is written until one is picked.
    expect(chapter(app, slug, 'chapter-01')).toContain('TODO:');

    const picked = await app.inject({
      method: 'POST',
      url: `/api/books/${slug}/discover/jobs/${job.id}/drafts/${job.drafts[1]!.id}`,
    });
    expect(picked.statusCode, picked.body).toBe(200);
    expect(picked.json<DiscoverState>().jobs).toEqual([]);
    expect(chapter(app, slug, 'chapter-01')).toContain('Fire.');
  }, 30_000);

  it('proposes variables from the premise for the setup form', async () => {
    const { app, slug } = await boot([
      () =>
        sse(
          text(
            'Here: {"variables": [{"name": "courage", "initial": "0", "meaning": "How brave"}, {"name": "bad name!", "initial": "0", "meaning": "x"}]}',
          ),
        ),
    ]);
    const response = await app.inject({
      method: 'POST',
      url: `/api/books/${slug}/discover/variables`,
      payload: { kernel: 'A keeper.', shape: '' },
    });
    expect(response.statusCode, response.body).toBe(200);
    const state = await settle(app, slug);
    expect(state.jobs[0]).toMatchObject({
      kind: 'variables',
      status: 'done',
      variables: [{ name: 'courage', initial: '0', meaning: 'How brave' }],
    });
  }, 30_000);
});
