import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AgentGeneration, BookSummary } from '@worldbookllm/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../db/database.js';
import { SkillFileStore } from '../files/skill-files.js';
import { SettingsService } from '../services/settings.js';
import { SkillService } from '../services/skills.js';
import type { BookService } from '../services/books.js';
import type { ProviderService } from '../services/providers.js';
import { KeyedMutex } from '../story/keyed-mutex.js';
import type { CheckpointSession } from '../story/checkpoints.js';
import { buildApp } from '../app.js';
import { AgentService, truncateResult } from './agent-service.js';
import { StorySkillsInstaller } from './story-skills-installer.js';
import { AgentChangesetService } from './changesets.js';
import { CustomAgentService } from './custom-agents.js';
import { AgentToolRegistry } from './tools.js';
import { LiveWorkspace } from './workspace.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('truncateResult', () => {
  it('keeps the omission notice inside 24 KB and does not split a character', () => {
    const result = truncateResult(`A${'😀'.repeat(20_000)}`);
    expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(24 * 1024);
    expect(result).toContain('[truncated:');
    expect(result).toContain('bytes omitted]');
    expect(result).not.toContain('\uFFFD');
  });
});

describe('stopping a turn', () => {
  it('does not start a later tool call after the signal is aborted', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'worldbookllm-abort-'));
    tempDirs.push(dataDir);
    const db = openDatabase(dataDir);
    const settings = new SettingsService(db);
    settings.updateSettings({
      providerConfig: { source: 'custom', model: 'local', baseUrl: 'http://provider.test/v1' },
    });
    const skills = new SkillService(db, new SkillFileStore(dataDir));
    const executed: string[] = [];
    let commits = 0;
    const controller = new AbortController();
    const books = {
      root() {
        return dataDir;
      },
      get() {
        return {
          slug: 'harbor',
          title: 'Harbor',
          genre: null,
          status: null,
          seriesId: null,
          bookNumber: null,
          counts: {},
          updatedAt: new Date().toISOString(),
        };
      },
      startSession() {
        return { book: 'harbor' };
      },
      async commitSession() {
        commits += 1;
        return null;
      },
    } as unknown as BookService;
    const providers = {
      createChatRequest() {
        return { url: 'http://provider.test/v1', method: 'POST', headers: {}, body: {} };
      },
      snapshotRequestBody() {
        return {};
      },
      openChatStream() {
        const payload = {
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'c1',
                    type: 'function',
                    function: { name: 'read_file', arguments: '{}' },
                  },
                  {
                    index: 1,
                    id: 'c2',
                    type: 'function',
                    function: { name: 'list_files', arguments: '{}' },
                  },
                ],
              },
            },
          ],
        };
        const body = `data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`;
        return Promise.resolve(new Response(body).body!);
      },
    } as unknown as ProviderService;
    const tools = {
      definitions: () => [],
      async execute(name: string) {
        executed.push(name);
        if (executed.length === 1) controller.abort();
        return { ok: true, result: 'ok' };
      },
    };
    const agent = new AgentService(
      db,
      books,
      skills,
      settings,
      providers,
      tools as unknown as AgentToolRegistry,
      new AgentChangesetService(db, books),
      new CustomAgentService(db, skills),
      join(dataDir, 'staging'),
    );
    const chat = agent.createChat('harbor');
    const prepared = agent.prepare(chat.id, 'Do both.');
    try {
      await agent.run(prepared, controller.signal, () => undefined);
    } finally {
      prepared.release();
    }
    expect(executed).toEqual(['read_file']);
    expect(commits).toBe(1);
    const detail = agent.getChat(chat.id);
    expect(detail.messages[1]?.status).toBe('interrupted');
    expect(detail.messages[1]?.steps[0]?.toolCalls.map((call) => call.name)).toEqual(['read_file']);
    db.close();
  });
});

describe('generation controls', () => {
  it('sends the agent generation settings with each request', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'worldbookllm-prefill-'));
    tempDirs.push(dataDir);
    const db = openDatabase(dataDir);
    const settings = new SettingsService(db);
    settings.updateSettings({
      providerConfig: { source: 'custom', model: 'local', baseUrl: 'http://provider.test/v1' },
    });
    settings.updateSettings({
      agentGeneration: { temperature: 0.4, topP: null, maxTokens: 2048, thinking: false },
    });
    const skills = new SkillService(db, new SkillFileStore(dataDir));
    const books = {
      root: () => dataDir,
      get: () => ({
        slug: 'harbor',
        title: 'Harbor',
        genre: null,
        status: null,
        seriesId: null,
        bookNumber: null,
        counts: {},
        updatedAt: new Date().toISOString(),
      }),
      startSession: () => ({ book: 'harbor' }),
      commitSession: async () => null,
    } as unknown as BookService;
    const seen: AgentGeneration[] = [];
    const providers = {
      createChatRequest(_config: unknown, _messages: unknown, controls: AgentGeneration) {
        seen.push(controls);
        return { url: 'http://provider.test/v1', method: 'POST', headers: {}, body: {} };
      },
      snapshotRequestBody: () => ({}),
      openChatStream: () =>
        Promise.resolve(
          new Response(
            `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'Hi.' } }] })}\n\ndata: [DONE]\n\n`,
          ).body!,
        ),
    } as unknown as ProviderService;
    const agent = new AgentService(
      db,
      books,
      skills,
      settings,
      providers,
      { definitions: () => [] } as unknown as AgentToolRegistry,
      new AgentChangesetService(db, books),
      new CustomAgentService(db, skills),
      join(dataDir, 'staging'),
    );
    const chat = agent.createChat('harbor');
    const prepared = agent.prepare(chat.id, 'Hello.');
    try {
      await agent.run(prepared, new AbortController().signal, () => undefined);
    } finally {
      prepared.release();
    }
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ temperature: 0.4, topP: null, maxTokens: 2048, thinking: false });
    db.close();
  });
});

describe('restarting the server', () => {
  it('records the pending checkpoint on the message while the turn runs', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'worldbookllm-pending-'));
    tempDirs.push(dataDir);
    const db = openDatabase(dataDir);
    const settings = new SettingsService(db);
    settings.updateSettings({
      providerConfig: { source: 'custom', model: 'local', baseUrl: 'http://provider.test/v1' },
    });
    const skills = new SkillService(db, new SkillFileStore(dataDir));
    const pendingId = '3f0c2b1a-9d8e-4c7b-a6f5-e4d3c2b1a098';
    const books = {
      root: () => dataDir,
      get: () => ({
        slug: 'harbor',
        title: 'Harbor',
        genre: null,
        status: null,
        seriesId: null,
        bookNumber: null,
        counts: {},
        updatedAt: new Date().toISOString(),
      }),
      startSession: () => ({ book: 'harbor', pendingId }),
      commitSession: async () => null,
    } as unknown as BookService;
    let midTurn: string | null | undefined;
    let requests = 0;
    const toolCall = {
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'c1',
                type: 'function',
                function: { name: 'write_file', arguments: '{}' },
              },
            ],
          },
        },
      ],
    };
    const text = { choices: [{ index: 0, delta: { content: 'Done.' } }] };
    const providers = {
      createChatRequest: () => ({
        url: 'http://provider.test/v1',
        method: 'POST',
        headers: {},
        body: {},
      }),
      snapshotRequestBody: () => ({}),
      openChatStream() {
        requests += 1;
        if (requests === 2) {
          midTurn = db
            .prepare("SELECT checkpoint_id FROM agent_messages WHERE role = 'assistant'")
            .pluck()
            .get() as string | null;
        }
        const payload = requests === 1 ? toolCall : text;
        return Promise.resolve(
          new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`).body!,
        );
      },
    } as unknown as ProviderService;
    const tools = {
      definitions: () => [],
      execute: async () => ({ ok: true, result: 'ok' }),
    };
    const agent = new AgentService(
      db,
      books,
      skills,
      settings,
      providers,
      tools as unknown as AgentToolRegistry,
      new AgentChangesetService(db, books),
      new CustomAgentService(db, skills),
      join(dataDir, 'staging'),
    );
    const chatId = agent.createChat('harbor').id;
    const prepared = agent.prepare(chatId, 'Write it.');
    try {
      await agent.run(prepared, new AbortController().signal, () => undefined);
    } finally {
      prepared.release();
    }
    expect(midTurn).toBe(pendingId);
    // The committed checkpoint replaces it when the turn ends (null: nothing changed).
    expect(agent.getChat(chatId).messages[1]?.checkpointId).toBeNull();
    db.close();
  });

  it('marks a turn left streaming by the previous process as interrupted', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'worldbookllm-restart-'));
    tempDirs.push(dataDir);
    const db = openDatabase(dataDir);
    const settings = new SettingsService(db);
    settings.updateSettings({
      providerConfig: { source: 'custom', model: 'local', baseUrl: 'http://provider.test/v1' },
    });
    const skills = new SkillService(db, new SkillFileStore(dataDir));
    const books = { root: () => dataDir } as unknown as BookService;
    const create = () =>
      new AgentService(
        db,
        books,
        skills,
        settings,
        {} as ProviderService,
        {} as unknown as AgentToolRegistry,
        new AgentChangesetService(db, books),
        new CustomAgentService(db, skills),
        join(dataDir, 'staging'),
      );
    const before = create();
    const chat = before.createChat('harbor');
    // prepare() stores the assistant message as streaming; the process then "exits".
    before.prepare(chat.id, 'Draft the opening.');
    expect(before.getChat(chat.id).messages[1]?.status).toBe('streaming');

    const after = create();
    expect(after.getChat(chat.id).messages.map((message) => message.status)).toEqual([
      'complete',
      'interrupted',
    ]);
    db.close();
  });
});

describe('run_story exit codes', () => {
  it('fails the tool for exits 2, 3 and 4, and keeps exit 1 informational', async () => {
    let exitCode = 0;
    const books = {
      async runStoryForAgent() {
        return { exitCode, stdout: '', stderr: 'diagnostic', envelope: null };
      },
    } as unknown as BookService;
    const registry = new AgentToolRegistry({} as SkillService, '/tmp/skills');
    const context = {
      workspace: new LiveWorkspace(books, { book: 'harbor' } as CheckpointSession),
      skills: null,
    };
    const args = JSON.stringify({ command: 'add', args: ['character', 'Mara'] });

    for (const code of [2, 3, 4]) {
      exitCode = code;
      const outcome = await registry.execute('run_story', args, context);
      expect(outcome.ok).toBe(false);
      expect(outcome.result).toContain(`exit code ${code}`);
      expect(outcome.result).toContain('diagnostic');
    }

    exitCode = 1;
    const findings = await registry.execute('run_story', args, context);
    expect(findings.ok).toBe(true);
    expect(findings.result).toContain('exit code 1');

    exitCode = 0;
    const ok = await registry.execute('run_story', args, context);
    expect(ok.ok).toBe(true);
  });
});

describe('story-skills installer recovery', () => {
  function sourceWith(dir: string) {
    const skillDir = join(dir, 'alpha');
    mkdirSync(join(skillDir, 'references'), { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '---\nname: alpha\ndescription: Pinned alpha skill.\n---\n\n# Alpha\n',
    );
    writeFileSync(join(skillDir, 'references/a.md'), 'reference A\n');
    writeFileSync(join(skillDir, 'references/b.md'), 'reference B\n');
  }

  it('repairs missing pinned references without overwriting edits', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'worldbookllm-skills-'));
    const sourceDir = mkdtempSync(join(tmpdir(), 'worldbookllm-skill-src-'));
    tempDirs.push(dataDir, sourceDir);
    sourceWith(sourceDir);
    const db = openDatabase(dataDir);
    const skills = new SkillService(db, new SkillFileStore(dataDir));
    const installer = new StorySkillsInstaller(skills, join(dataDir, 'skills'), sourceDir);
    const first = installer.install();
    expect(first.installed.map((skill) => skill.name)).toEqual(['alpha']);

    const installed = skills.list()[0]!;
    writeFileSync(join(dataDir, 'skills/alpha/references/a.md'), 'user edited A\n');
    rmSync(join(dataDir, 'skills/alpha/references/b.md'));
    skills.patch(installed.id, { content: '# Alpha\n\nEdited by the user.\n' });

    const again = installer.install();
    expect(again.installed).toEqual([]);
    expect(again.skipped).toEqual(['alpha']);
    expect(readFileSync(join(dataDir, 'skills/alpha/references/a.md'), 'utf8')).toBe(
      'user edited A\n',
    );
    expect(readFileSync(join(dataDir, 'skills/alpha/references/b.md'), 'utf8')).toBe(
      'reference B\n',
    );
    expect(skills.get(installed.id).content).toContain('Edited by the user.');
    db.close();
  });

  it('does not add references to a skill the user created', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'worldbookllm-skills-'));
    const sourceDir = mkdtempSync(join(tmpdir(), 'worldbookllm-skill-src-'));
    tempDirs.push(dataDir, sourceDir);
    sourceWith(sourceDir);
    const db = openDatabase(dataDir);
    const skills = new SkillService(db, new SkillFileStore(dataDir));
    skills.create({ name: 'alpha', description: 'Mine.', content: '# Mine\n' });
    const installer = new StorySkillsInstaller(skills, join(dataDir, 'skills'), sourceDir);
    const result = installer.install();
    expect(result.installed).toEqual([]);
    expect(result.skipped).toEqual(['alpha']);
    expect(readFileSync(join(dataDir, 'skills/alpha/SKILL.md'), 'utf8')).toContain('# Mine');
    expect(readFileSync(join(dataDir, 'skills/alpha/SKILL.md'), 'utf8')).not.toContain(
      'Pinned alpha',
    );
    db.close();
  });

  it('does not repair a legacy bundled skill from the starter catalog', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'worldbookllm-skills-'));
    const sourceDir = mkdtempSync(join(tmpdir(), 'worldbookllm-skill-src-'));
    tempDirs.push(dataDir, sourceDir);
    sourceWith(sourceDir);
    const db = openDatabase(dataDir);
    const skills = new SkillService(db, new SkillFileStore(dataDir));
    skills.create({
      name: 'alpha',
      description: 'Legacy starter.',
      content: '# Legacy starter\n',
      origin: { type: 'bundled', starterId: 'alpha' },
    });

    const installer = new StorySkillsInstaller(skills, join(dataDir, 'skills'), sourceDir);
    expect(installer.install()).toMatchObject({ installed: [], skipped: ['alpha'] });
    expect(existsSync(join(dataDir, 'skills/alpha/references/a.md'))).toBe(false);
    db.close();
  });
});

describe('agent edits and checkpoints', () => {
  let app: FastifyInstance;
  let dataDir: string;

  afterEach(async () => {
    await app?.close();
  });

  async function bootBook(): Promise<{ books: BookService; slug: string }> {
    dataDir = mkdtempSync(join(tmpdir(), 'worldbookllm-checkpoint-'));
    tempDirs.push(dataDir);
    app = buildApp({ dataDir, logger: false });
    const book = (
      await app.inject({ method: 'POST', url: '/api/books', payload: { title: 'Harbor' } })
    ).json<BookSummary>();
    return { books: app.services.books, slug: book.slug };
  }

  it('does not clobber a user edit that lands while edit_file waits for the lock', async () => {
    const { books, slug } = await bootBook();
    const path = 'notes/page.md';
    await books.writeFile(slug, path, { content: 'hello world', expectedHash: null });
    const session = books.startSession(slug, 'Agent: edit', 'agent');
    const registry = new AgentToolRegistry(app.services.skills, join(dataDir, 'skills'));

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holding!: () => void;
    const held = new Promise<void>((resolve) => {
      holding = resolve;
    });
    const original = KeyedMutex.prototype.run;
    let armed = true;
    KeyedMutex.prototype.run = function <T>(
      this: KeyedMutex,
      key: string,
      work: () => Promise<T> | T,
    ) {
      // Function.prototype.call erases run's generic, so restore it here.
      return original.call(this, key, async () => {
        if (armed && key === slug) {
          armed = false;
          holding();
          await gate;
        }
        return work();
      }) as Promise<T>;
    };

    try {
      const current = books.readFile(slug, path);
      const userWrite = books.writeFile(slug, path, {
        content: 'hello USER',
        expectedHash: current.hash,
      });
      await held;
      const edit = registry.execute(
        'edit_file',
        JSON.stringify({ path, find: 'hello', replace: 'HELLO' }),
        { workspace: new LiveWorkspace(books, session), skills: null },
      );
      release();
      const [outcome] = await Promise.all([edit, userWrite]);
      expect(outcome.ok).toBe(true);
      expect(books.readFile(slug, path).content).toBe('HELLO USER');
    } finally {
      KeyedMutex.prototype.run = original;
    }
  });

  it('requires write_file to match the hash returned by read_file', async () => {
    const { books, slug } = await bootBook();
    const path = 'notes/page.md';
    await books.writeFile(slug, path, { content: 'original', expectedHash: null });
    const session = books.startSession(slug, 'Agent: guarded write', 'agent');
    const registry = new AgentToolRegistry(app.services.skills, join(dataDir, 'skills'));
    const writeTool = registry
      .definitions()
      .find((definition) => definition.function.name === 'write_file');
    expect(writeTool?.function.parameters).toMatchObject({
      required: expect.arrayContaining(['expectedHash']),
    });

    const read = await registry.execute('read_file', JSON.stringify({ path }), {
      workspace: new LiveWorkspace(books, session),
      skills: null,
    });
    expect(read.ok).toBe(true);
    const observed = JSON.parse(read.result) as { path: string; hash: string; content: string };
    expect(observed).toMatchObject({ path, content: 'original' });

    await books.writeFile(slug, path, { content: 'user edit', expectedHash: observed.hash });
    const stale = await registry.execute(
      'write_file',
      JSON.stringify({ path, content: 'agent edit', expectedHash: observed.hash }),
      { workspace: new LiveWorkspace(books, session), skills: null },
    );
    expect(stale).toMatchObject({ ok: false, result: expect.stringMatching(/changed/u) });
    expect(books.readFile(slug, path).content).toBe('user edit');
  });

  it('rejects overlapping edit_file matches as ambiguous', async () => {
    const { books, slug } = await bootBook();
    const path = 'notes/page.md';
    await books.writeFile(slug, path, { content: 'banana', expectedHash: null });
    const session = books.startSession(slug, 'Agent: ambiguous edit', 'agent');
    const registry = new AgentToolRegistry(app.services.skills, join(dataDir, 'skills'));

    const outcome = await registry.execute(
      'edit_file',
      JSON.stringify({ path, find: 'ana', replace: 'X' }),
      { workspace: new LiveWorkspace(books, session), skills: null },
    );
    expect(outcome).toMatchObject({ ok: false });
    expect(outcome.result).toMatch(/2 times/u);
    expect(books.readFile(slug, path).content).toBe('banana');
  });

  it('preserves both checkpoints when a user edit lands between agent writes', async () => {
    const { books, slug } = await bootBook();
    const path = 'notes/page.md';
    await books.writeFile(slug, path, { content: 'original', expectedHash: null });
    const session = books.startSession(slug, 'Agent: two writes', 'agent');
    await books.writeInSession(session, path, 'agent-1', books.readFile(slug, path).hash);
    const current = books.readFile(slug, path);
    await books.writeFile(slug, path, { content: 'user-edit', expectedHash: current.hash });
    await expect(
      books.writeInSession(session, path, 'agent-2', books.readFile(slug, path).hash),
    ).rejects.toMatchObject({ code: 'checkpoint_interleaved' });
    expect(books.readFile(slug, path).content).toBe('user-edit');

    const checkpoint = await books.commitSession(session);
    expect(checkpoint).not.toBeNull();
    expect(checkpoint?.files.map((file) => file.path)).toEqual([path]);

    const checkpoints = books.listCheckpoints(slug);
    expect(checkpoints.slice(0, 2).map((entry) => entry.actor)).toEqual(['user', 'agent']);
    expect(checkpoints[1]?.id).toBe(checkpoint!.id);
    await books.undo(slug, checkpoints[0]!.id);
    expect(books.readFile(slug, path).content).toBe('agent-1');
    await books.undo(slug, checkpoint!.id);
    expect(books.readFile(slug, path).content).toBe('original');
  });

  it('preserves the agent checkpoint when a user writes after the last agent write', async () => {
    const { books, slug } = await bootBook();
    const path = 'notes/page.md';
    await books.writeFile(slug, path, { content: 'original', expectedHash: null });
    const session = books.startSession(slug, 'Agent: one write', 'agent');
    await books.writeInSession(session, path, 'agent', books.readFile(slug, path).hash);
    const current = books.readFile(slug, path);
    await books.writeFile(slug, path, { content: 'user', expectedHash: current.hash });
    const checkpoint = await books.commitSession(session);
    expect(checkpoint).not.toBeNull();

    const latest = books.listCheckpoints(slug)[0];
    expect(latest?.actor).toBe('user');
    await books.undo(slug, latest!.id);
    expect(books.readFile(slug, path).content).toBe('agent');
    await books.undo(slug, checkpoint!.id);
    expect(books.readFile(slug, path).content).toBe('original');
  });
});
