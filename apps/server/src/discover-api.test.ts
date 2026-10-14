import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  BeatWriterInstallResult,
  BookSummary,
  Checkpoint,
  DiscoverState,
} from '@worldbookllm/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { BEAT_SKILLS_PACKAGE } from './agent/discover/beat-skills.js';
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

/** Boots the app with a scripted model and an interactive book, converted from these chapters' prose. */
async function boot(
  script: Array<() => Response | Promise<Response>>,
  chapters: readonly string[] = [],
) {
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
  for (const [index, prose] of chapters.entries()) {
    await app.services.books.addEntity(book.slug, {
      kind: 'chapter',
      name: `Chapter ${index + 1}`,
      options: {},
    });
    const path = `chapters/chapter-${String(index + 1).padStart(2, '0')}.md`;
    const file = app.services.books.readFile(book.slug, path);
    await app.services.books.writeFile(book.slug, path, {
      content: `${file.content}\n${prose}\n`,
      expectedHash: file.hash,
    });
  }
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
    // A seed written by hand is written, though its frontmatter still says seed.
    const seed = app.services.books.readFile(slug, 'chapters/chapter-02.md');
    await app.services.books.writeFile(slug, 'chapters/chapter-02.md', {
      content: seed.content.replace(/TODO:[^\n]*\n/u, 'It is from Tom.\n'),
      expectedHash: seed.hash,
    });
    const again = await app.inject({
      method: 'POST',
      url: `/api/books/${slug}/builds`,
      payload: { format: 'ink' },
    });
    expect(again.json<{ output: string }>().output).toContain(
      '1 branch is not written yet, so it ends the story: Burn it unread.',
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

  it('goes on from the end of a chapter the writer wrote before converting the book', async () => {
    const { app, slug } = await boot(
      [() => sse(toolCall('choices', 'write_choices', { choices: THREE })), PASS],
      ['The keeper finds a letter on the step.'],
    );
    const setup = await app.inject({
      method: 'PUT',
      url: `/api/books/${slug}/discover/setup`,
      payload: {
        setup: {
          mode: 'cowrite',
          lookahead: 1,
          choices: 3,
          beatLength: 'scene',
          rejoin: 'sometimes',
          endings: '',
          kernel: '',
          shape: '',
        },
        rules: '1. Different intents.',
        variables: [],
      },
    });
    expect(setup.statusCode, setup.body).toBe(200);
    // Discovery does not manage the writer's chapter, so it is no beat of its own.
    expect(setup.json<DiscoverState>().beats).toEqual([]);

    const write = await app.inject({
      method: 'POST',
      url: `/api/books/${slug}/discover/write`,
      payload: { chapterId: 'chapter-01', position: { from: null, set: {}, seed: 1, path: [] } },
    });
    expect(write.statusCode, write.body).toBe(200);
    const state = await settle(app, slug);
    const opening = chapter(app, slug, 'chapter-01');
    // The prose stays as written; the choices go on from it, each to a beat not written yet.
    expect(opening).toContain(
      'The keeper finds a letter on the step.\n\n* [Open the letter] -> chapter_02',
    );
    expect(state.openThreads.map((thread) => thread.chapterId)).toEqual([
      'chapter-02',
      'chapter-03',
      'chapter-04',
    ]);
  }, 30_000);

  it('writes beats as the custom agent the setup picks, with its beat writer skills loaded or to load, never Story Skills', async () => {
    const { app, slug, requests } = await boot(
      [
        () => sse(toolCall('choices', 'write_choices', { choices: THREE })),
        PASS,
        () => sse(toolCall('skill', 'activate_skill', { name: 'cold-prose' })),
        () => sse(toolCall('choices', 'write_choices', { choices: THREE })),
        PASS,
      ],
      ['The keeper waits.', 'The sea waits.'],
    );
    const skill = await app.inject({
      method: 'POST',
      url: '/api/skills',
      payload: {
        name: 'cold-prose',
        description: 'Spare, cold prose.',
        // Longer than the beat writer's 16,000-character cap on other tool results, as skills can be.
        content: `# Cold prose\n\n${'Keep it spare. '.repeat(1_200)}Short sentences. No adverbs.`,
      },
    });
    expect(skill.statusCode, skill.body).toBe(201);
    // Two more long skills: past the budget for loaded skills, the last is listed to load instead.
    for (const name of ['grey-dialogue', 'salt-weather']) {
      app.services.skills.create({
        name,
        description: `${name} notes.`,
        content: `# ${name}\n\n${'Say less. '.repeat(2_200)}End of ${name}.`,
      });
    }
    // A Story Skill is written for chats; the beat writer leaves it out even when named.
    app.services.skills.create({
      name: 'scene-craft',
      description: 'Plan a scene.',
      content: '# Scene craft\n\nRun story scenes.',
      license: 'MIT',
      origin: { type: 'story-skills', package: 'story-skills@0.23.0', skillId: 'scene-craft' },
    });
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/api/agents',
        payload: {
          name: 'Gothic narrator',
          instructions: 'Let the sea feel watchful.',
          skills: ['cold-prose', 'grey-dialogue', 'salt-weather', 'scene-craft'],
        },
      })
    ).json<{ id: string }>();
    const save = (agentId: string | null) =>
      app.inject({
        method: 'PUT',
        url: `/api/books/${slug}/discover/setup`,
        payload: {
          setup: {
            mode: 'cowrite',
            lookahead: 1,
            choices: 3,
            beatLength: 'scene',
            rejoin: 'sometimes',
            endings: '',
            kernel: '',
            shape: '',
            agentId,
          },
          rules: '1. Different intents.',
          variables: [],
        },
      });
    const write = async (chapterId: string) => {
      await app.inject({
        method: 'POST',
        url: `/api/books/${slug}/discover/write`,
        payload: { chapterId, position: null },
      });
      return settle(app, slug);
    };
    const saved = await save(agent.id);
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json<DiscoverState>().setup?.agentId).toBe(agent.id);

    // A skill the agent names comes loaded, whole, so every beat follows it.
    await write('chapter-01');
    const system = JSON.stringify(requests[0]);
    expect(system).toContain('## Your role: Gothic narrator');
    expect(system).toContain('Let the sea feel watchful.');
    expect(system).toContain('#### Skill: cold-prose');
    expect(system).toContain('Short sentences. No adverbs.');
    expect(system).toContain('End of grey-dialogue.');
    expect(system).not.toContain('End of salt-weather.');
    expect(system).toContain('### Skills you can load');
    expect(system).toContain('- salt-weather: salt-weather notes.');
    expect(system).not.toContain('scene-craft');

    // An agent allowed every skill gets the list, and loads one when it fits, as in a chat.
    await app.inject({
      method: 'PATCH',
      url: `/api/agents/${agent.id}`,
      payload: { skills: null },
    });
    await write('chapter-02');
    const listed = JSON.stringify(requests[2]);
    expect(listed).toContain('- cold-prose: Spare, cold prose.');
    expect(listed).not.toContain('scene-craft');
    expect(listed).not.toContain('Short sentences. No adverbs.');
    expect(JSON.stringify(requests[3])).toContain('Short sentences. No adverbs.');

    // An agent that no longer exists cannot be picked.
    await app.inject({ method: 'DELETE', url: `/api/agents/${agent.id}` });
    expect((await save(agent.id)).statusCode).toBe(400);
  }, 30_000);

  it('tells a beat writer that keeps reading to write, and offers it only the writing tool', async () => {
    const read = () => sse(toolCall('read', 'read_file', { path: 'story.md' }));
    const { app, slug, requests } = await boot(
      [
        read,
        read,
        read,
        read,
        read,
        () => sse(toolCall('choices', 'write_choices', { choices: THREE })),
        PASS,
      ],
      ['The keeper waits.'],
    );
    await setUp(app, slug, { mode: 'cowrite', opening: null });
    await app.inject({
      method: 'POST',
      url: `/api/books/${slug}/discover/write`,
      payload: { chapterId: 'chapter-01', position: null },
    });
    const state = await settle(app, slug);
    expect(state.jobs.filter((job) => job.status === 'failed')).toEqual([]);
    const names = (index: number) =>
      (requests[index]?.tools as Array<{ function: { name: string } }>).map(
        (tool) => tool.function.name,
      );
    expect(names(3)).toContain('read_file');
    // From the fifth step it may only write, and it is told so.
    expect(names(4)).toEqual(['write_choices']);
    expect(JSON.stringify(requests[4])).toContain('You have read enough to write this.');
    expect(chapter(app, slug, 'chapter-01')).toContain('Open the letter');
    // The review is told which parts of a choice the reader sees.
    expect(JSON.stringify(requests[6])).toContain('they are never spoilers');
  }, 30_000);

  it('follows calls a model prints instead of making, as some do', async () => {
    const { app, slug, requests } = await boot(
      [
        // Planning that ends in a read call written out, as gpt-oss on some hosts does.
        () => sse(text('We need the opening. Let\'s read it.{"path": "chapter_01.txt"}')),
        // Then the writing call, wrapped as a call object, with a chapter id where leads_to wants "existing".
        () =>
          sse(
            text(
              `Now the call: ${JSON.stringify({
                name: 'write_choices',
                arguments: {
                  choices: [
                    choice('Open the letter', 'curiosity'),
                    choice('Burn it unread', 'refusal'),
                    { ...choice('Read it again', 'doubt'), leads_to: 'chapter-01' },
                  ],
                },
              })}`,
            ),
          ),
        PASS,
      ],
      ['The keeper finds a letter on the step.', 'She carries it up the stairs.'],
    );
    await setUp(app, slug, { mode: 'cowrite', opening: null });
    const write = await app.inject({
      method: 'POST',
      url: `/api/books/${slug}/discover/write`,
      payload: { chapterId: 'chapter-02', position: null },
    });
    expect(write.statusCode, write.body).toBe(200);
    const state = await settle(app, slug);
    expect(state.jobs.filter((job) => job.status === 'failed').map((job) => job.message)).toEqual(
      [],
    );
    // The printed read was answered with the chapter, found from its knot-style name.
    expect(JSON.stringify(requests[1])).toContain('The keeper finds a letter on the step.');
    expect(chapter(app, slug, 'chapter-02')).toContain('* [Read it again] -> chapter_01');
  }, 30_000);

  it('gives the beat writer the path that reaches the writer’s own chapter', async () => {
    const { app, slug, requests } = await boot(
      [() => sse(toolCall('choices', 'write_choices', { choices: THREE })), PASS],
      ['The keeper finds a letter on the step.', 'She carries it up the stairs.'],
    );
    await setUp(app, slug, { mode: 'cowrite', opening: null });
    const write = await app.inject({
      method: 'POST',
      url: `/api/books/${slug}/discover/write`,
      // The first chapter goes on into the second, so the reader is at the second.
      payload: { chapterId: 'chapter-02', position: { from: null, set: {}, seed: 1, path: [] } },
    });
    expect(write.statusCode, write.body).toBe(200);
    await settle(app, slug);
    const prompt = JSON.stringify(requests[0]);
    const path = prompt.slice(prompt.indexOf('## What the reader has read on this path'));
    expect(path).toContain('The keeper finds a letter on the step.');
    expect(chapter(app, slug, 'chapter-02')).toContain(
      'She carries it up the stairs.\n\n* [Open the letter] -> chapter_03',
    );
  }, 30_000);

  it('installs the beat writer skills and the agent that names them, which the beat writer then follows', async () => {
    const { app, slug, requests } = await boot(
      [() => sse(toolCall('choices', 'write_choices', { choices: THREE })), PASS],
      ['The keeper waits.'],
    );
    const first = await app.inject({ method: 'POST', url: '/api/beat-writer/install' });
    expect(first.statusCode, first.body).toBe(201);
    const installed = first.json<BeatWriterInstallResult>();
    const names = [
      'beat-shape',
      'branch-economy',
      'choice-design',
      'memory-and-state',
      'reader-actions',
      'voice-continuity',
    ];
    expect(installed.skills.installed.map((skill) => skill.name)).toEqual(names);
    expect(installed.skills.installed[0]).toMatchObject({
      license: 'AGPL-3.0-only',
      origin: { type: 'beat-skills', package: BEAT_SKILLS_PACKAGE, skillId: 'beat-shape' },
    });
    expect(installed.agent).toMatchObject({ name: 'Beat writer', skills: names });

    // Installing again keeps the agent the writer may have edited.
    const second = (
      await app.inject({ method: 'POST', url: '/api/beat-writer/install' })
    ).json<BeatWriterInstallResult>();
    expect(second.agent.id).toBe(installed.agent.id);
    expect(second.skills.skipped).toEqual(names);

    const saved = await app.inject({
      method: 'PUT',
      url: `/api/books/${slug}/discover/setup`,
      payload: {
        setup: {
          mode: 'cowrite',
          lookahead: 1,
          choices: 3,
          beatLength: 'scene',
          rejoin: 'sometimes',
          endings: '',
          kernel: '',
          shape: '',
          agentId: installed.agent.id,
        },
        rules: '1. Different intents.',
        variables: [],
      },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    await app.inject({
      method: 'POST',
      url: `/api/books/${slug}/discover/write`,
      payload: { chapterId: 'chapter-01', position: null },
    });
    await settle(app, slug);
    // All six fit the beat writer's skill budget, whole.
    const system = JSON.stringify(requests[0]);
    for (const name of names) expect(system).toContain(`#### Skill: ${name}`);
    expect(system).toContain('Accept by default');
  }, 30_000);

  it('turns the reader’s own action into a real choice, or declines it with a reason the writer can overrule', async () => {
    const { app, slug, requests } = await boot([
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
      () =>
        sse(
          toolCall('anyway', 'accept_action', {
            choice: {
              text: 'Row for the mainland',
              intent: 'escape',
              consequence: 'the rock is left dark',
            },
            beat: {
              title: 'The Crossing',
              summary: 'You find a boat after all.',
              ink: 'The old skiff was still under the tarp.',
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
        action: 'Row a boat to the mainland',
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

    // The writer overrules the decline: the beat writer is not offered decline_action.
    await app.inject({
      method: 'POST',
      url: `/api/books/${slug}/discover/something-else`,
      payload: { position, action: 'Row a boat to the mainland', force: true },
    });
    state = await settle(app, slug);
    expect(state.jobs.at(-1)).toMatchObject({
      title: 'Writing "Row a boat to the mainland"',
      status: 'done',
      outcome: { accepted: true, chapterId: 'chapter-01', choice: 4 },
    });
    const forced = requests.at(-1) as { tools: Array<{ function: { name: string } }> };
    expect(forced.tools.map((tool) => tool.function.name)).not.toContain('decline_action');
    expect(JSON.stringify(forced)).toContain('The writer has decided this happens here');
    expect(chapter(app, slug, 'chapter-03')).toContain('The old skiff was still under the tarp.');
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
      // A name ink cannot use is made into one it can, not dropped.
      variables: [
        { name: 'courage', initial: '0', meaning: 'How brave' },
        { name: 'bad_name', initial: '0', meaning: 'x' },
      ],
    });
  }, 30_000);

  it('drafts the premise, shape and tone, and endings for the setup form', async () => {
    const { app, slug } = await boot([
      () =>
        sse(
          text(
            '{"kernel": "A keeper finds a letter.", "shape": "", "endings": "Two,\\n one kind"}',
          ),
        ),
    ]);
    const response = await app.inject({
      method: 'POST',
      url: `/api/books/${slug}/discover/story`,
      payload: { kernel: '', shape: 'Short.', endings: '' },
    });
    expect(response.statusCode, response.body).toBe(200);
    const state = await settle(app, slug);
    expect(state.jobs[0]).toMatchObject({
      kind: 'story',
      status: 'done',
      // A field the model leaves blank keeps what the writer sent.
      story: {
        kernel: 'A keeper finds a letter.',
        shape: 'Short.',
        endings: 'Two, one kind',
      },
    });
  }, 30_000);

  it('drafts the setup from the scenes already written, where the premise is optional', async () => {
    const { app, slug, requests } = await boot([
      () => sse(text('{"kernel": "A keeper climbs.", "shape": "Cold.", "endings": "Two"}')),
    ]);
    const blank = await app.inject({
      method: 'PUT',
      url: `/api/books/${slug}/discover/setup`,
      payload: {
        setup: {
          mode: 'cowrite',
          lookahead: 1,
          choices: 3,
          beatLength: 'scene',
          rejoin: 'sometimes',
          endings: '',
          kernel: '',
          shape: '',
        },
        rules: '1. Different intents.',
        variables: [],
        opening: null,
      },
    });
    // With no chapters and no opening scene, the beat writer would write the opening from nothing.
    expect(blank.statusCode, blank.body).toBe(400);

    const saved = await app.inject({
      method: 'PUT',
      url: `/api/books/${slug}/discover/setup`,
      payload: {
        setup: {
          mode: 'cowrite',
          lookahead: 1,
          choices: 3,
          beatLength: 'scene',
          rejoin: 'sometimes',
          endings: '',
          kernel: '',
          shape: '',
        },
        rules: '1. Different intents.',
        variables: [],
        opening: '# The Rock\n\nThe keeper climbs the stairs with the letter.',
      },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    await settle(app, slug);

    const response = await app.inject({
      method: 'POST',
      url: `/api/books/${slug}/discover/story`,
      payload: { kernel: '', shape: '', endings: '' },
    });
    expect(response.statusCode, response.body).toBe(200);
    const state = await settle(app, slug);
    expect(state.jobs.find((job) => job.kind === 'story')).toMatchObject({
      status: 'done',
      story: { kernel: 'A keeper climbs.', shape: 'Cold.', endings: 'Two' },
    });
    const prompt = JSON.stringify(requests.at(-1));
    expect(prompt).toContain('## Written so far');
    expect(prompt).toContain('The keeper climbs the stairs with the letter.');
  }, 30_000);

  it('keeps drafts when the one picked no longer compiles, and stops lead work on switching to co-write', async () => {
    const draft = () =>
      sse(
        toolCall('d', 'write_beat', {
          title: 'Kindness',
          summary: 'You are kind.',
          ink: 'You smile.',
          ending: false,
          choices: [
            choice('Thank her', 'gratitude', { effects: ['trust += 1'] }),
            choice('Say nothing', 'silence'),
            choice('Leave', 'flight', { leads_to: 'end' }),
          ],
        }),
      );
    const { app, slug } = await boot([draft, PASS, draft, PASS, draft, PASS]);
    await setUp(app, slug, { mode: 'cowrite', opening: null });
    await app.inject({
      method: 'POST',
      url: `/api/books/${slug}/discover/drafts`,
      payload: { chapterId: 'chapter-01', position: null },
    });
    const job = (await settle(app, slug)).jobs[0]!;
    expect(job.drafts).toHaveLength(3);

    // The writer drops the variable the drafts set, then picks one.
    const files = app.services.books;
    const variables = files.readFile(slug, 'ink/variables.md');
    await files.writeFile(slug, 'ink/variables.md', {
      content: variables.content.replace(/\/\/[^\n]*\nVAR trust = 0\n/u, ''),
      expectedHash: variables.hash,
    });
    const picked = await app.inject({
      method: 'POST',
      url: `/api/books/${slug}/discover/jobs/${job.id}/drafts/${job.drafts[0]!.id}`,
    });
    expect(picked.statusCode).toBe(400);
    expect(picked.body).toContain('This draft no longer fits the book');
    const state = (
      await app.inject({ method: 'GET', url: `/api/books/${slug}/discover` })
    ).json<DiscoverState>();
    expect(state.jobs.map((entry) => entry.id)).toEqual([job.id]);
    expect(chapter(app, slug, 'chapter-01')).toContain('TODO:');
  }, 30_000);

  it('drops queued lead work when the setup switches to co-write', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
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
      // The first beat after the choices is held until the setup has switched.
      async () => {
        await gate;
        return beat('First')();
      },
      beat('Second'),
      beat('Third'),
    ]);
    await setUp(app, slug, { mode: 'lead', opening: 'Wind.' });
    let state: DiscoverState | null = null;
    for (let attempt = 0; attempt < 400; attempt += 1) {
      state = (
        await app.inject({ method: 'GET', url: `/api/books/${slug}/discover` })
      ).json<DiscoverState>();
      if (state.jobs.filter((entry) => entry.status === 'queued').length === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(state?.jobs.map((entry) => entry.status)).toEqual(['running', 'queued', 'queued']);
    await setUp(app, slug, { mode: 'cowrite', opening: null });
    release();
    state = await settle(app, slug);
    // The beat already being written finishes; the two queued are not written.
    expect(chapter(app, slug, 'chapter-02')).toContain('First.');
    expect(state.openThreads.map((thread) => thread.chapterId)).toEqual([
      'chapter-03',
      'chapter-04',
    ]);
  }, 30_000);

  it('offers the reader’s own action only at a beat’s closing choices, not inside a scene', async () => {
    const { app, slug } = await boot([PASS]);
    await setUp(app, slug, { mode: 'cowrite', opening: 'The keeper waits.' });
    const files = app.services.books;
    const first = files.readFile(slug, 'chapters/chapter-01.md');
    await files.writeFile(slug, 'chapters/chapter-01.md', {
      content: first.content.replace(
        '-> END',
        '* [Look around] You look.\n- She is still there.\n\n* [Stay] -> END\n* [Go] -> END',
      ),
      expectedHash: first.hash,
    });
    await app.inject({
      method: 'POST',
      url: `/api/books/${slug}/discover/something-else`,
      payload: { position: { from: null, set: {}, seed: 1, path: [] }, action: 'Shout' },
    });
    const state = await settle(app, slug);
    expect(state.closingChoices).toEqual({ 'chapter-01': ['Stay', 'Go'] });
    expect(state.jobs[0]).toMatchObject({
      status: 'failed',
      message: 'Something else works where a beat ends in its choices, not inside a scene.',
    });
  }, 30_000);
});
