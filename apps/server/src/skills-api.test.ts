import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { SkillMetadata } from '@worldbookllm/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';

const tempDirs: string[] = [];
let app: FastifyInstance;
let dataDir: string;

function makeStarterDir(): string {
  const starterDir = mkdtempSync(join(tmpdir(), 'worldbookllm-starter-'));
  tempDirs.push(starterDir);
  for (const [starterId, name, description] of [
    ['character-voice', 'character-voice', 'Keep character voices distinct.'],
    ['settlement-design', 'settlement-design', 'Design believable settlements.'],
  ]) {
    mkdirSync(join(starterDir, String(starterId)), { recursive: true });
    writeFileSync(
      join(starterDir, String(starterId), 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${description}\nlicense: MIT\nauthor: upstream\n---\n# ${name}\n\nInstructions.\n`,
      { mode: 0o600 },
    );
  }
  return starterDir;
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'worldbookllm-skills-api-'));
  tempDirs.push(dataDir);
  app = buildApp({ dataDir, logger: false, starterSkillsDir: makeStarterDir() });
});

afterEach(async () => {
  await app.close();
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const newSkill = {
  name: 'story-sense',
  description: 'Diagnose what a story needs.',
  content: '# Story sense\n\nAssess, diagnose, intervene.\n',
};

describe('skills API', () => {
  it('creates, lists, reads, patches, and deletes skills', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/skills', payload: newSkill });
    expect(created.statusCode).toBe(201);
    const skill = created.json<SkillMetadata>();
    expect(skill).toMatchObject({
      name: 'story-sense',
      origin: { type: 'created' },
      license: null,
      dirPath: 'skills/story-sense',
    });
    expect(existsSync(join(dataDir, 'skills/story-sense/SKILL.md'))).toBe(true);

    const listed = await app.inject({ method: 'GET', url: '/api/skills' });
    expect(listed.json<SkillMetadata[]>().map((entry) => entry.name)).toEqual(['story-sense']);

    const read = await app.inject({ method: 'GET', url: `/api/skills/${skill.id}` });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ content: newSkill.content });

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/skills/${skill.id}`,
      payload: { description: 'Updated' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({ description: 'Updated' });

    const deleted = await app.inject({ method: 'DELETE', url: `/api/skills/${skill.id}` });
    expect(deleted.statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/api/skills' })).json()).toEqual([]);
  });

  it('rejects invalid names, duplicate names, and unknown ids', async () => {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/skills',
          payload: { ...newSkill, name: 'Bad Name' },
        })
      ).statusCode,
    ).toBe(400);

    await app.inject({ method: 'POST', url: '/api/skills', payload: newSkill });
    const duplicate = await app.inject({ method: 'POST', url: '/api/skills', payload: newSkill });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ error: 'skill_name_conflict' });

    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/skills/61c1f2b8-0000-4000-8000-000000000000',
        })
      ).statusCode,
    ).toBe(404);
  });

  it('lists the starter catalog with installed flags and installs idempotently', async () => {
    const before = await app.inject({ method: 'GET', url: '/api/skills-starter' });
    expect(before.json()).toEqual([
      {
        starterId: 'character-voice',
        name: 'character-voice',
        description: 'Keep character voices distinct.',
        installed: false,
      },
      {
        starterId: 'settlement-design',
        name: 'settlement-design',
        description: 'Design believable settlements.',
        installed: false,
      },
    ]);

    const install = await app.inject({
      method: 'POST',
      url: '/api/skills-starter/install',
      payload: { starterIds: ['character-voice'] },
    });
    expect(install.statusCode).toBe(201);
    expect(install.json<SkillMetadata[]>()).toHaveLength(1);
    expect(install.json<SkillMetadata[]>()[0]).toMatchObject({
      name: 'character-voice',
      origin: { type: 'bundled', starterId: 'character-voice' },
      license: 'MIT',
    });

    const again = await app.inject({
      method: 'POST',
      url: '/api/skills-starter/install',
      payload: { starterIds: ['character-voice', 'settlement-design'] },
    });
    expect(again.statusCode).toBe(201);
    expect(again.json<SkillMetadata[]>().map((entry) => entry.name)).toEqual(['settlement-design']);

    const after = await app.inject({ method: 'GET', url: '/api/skills-starter' });
    expect(after.json<Array<{ installed: boolean }>>().every((entry) => entry.installed)).toBe(
      true,
    );

    const unknown = await app.inject({
      method: 'POST',
      url: '/api/skills-starter/install',
      payload: { starterIds: ['nope'] },
    });
    expect(unknown.statusCode).toBe(404);
  });

  it('installs a batch all-or-nothing when one destination is blocked', async () => {
    // An unindexed folder occupying a later starter's destination must fail
    // the whole batch without leaving earlier starters half-installed.
    mkdirSync(join(dataDir, 'skills/settlement-design'), { recursive: true });
    writeFileSync(join(dataDir, 'skills/settlement-design/SKILL.md'), 'user-authored', {
      mode: 0o600,
    });

    const install = await app.inject({
      method: 'POST',
      url: '/api/skills-starter/install',
      payload: { starterIds: ['character-voice', 'settlement-design'] },
    });
    expect(install.statusCode).toBe(409);
    expect((await app.inject({ method: 'GET', url: '/api/skills' })).json()).toEqual([]);
    expect(existsSync(join(dataDir, 'skills/character-voice'))).toBe(false);
    expect(readFileSync(join(dataDir, 'skills/settlement-design/SKILL.md'), 'utf8')).toBe(
      'user-authored',
    );
  });

  it('tracks installation by starter id so renamed starters are not duplicated', async () => {
    const install = await app.inject({
      method: 'POST',
      url: '/api/skills-starter/install',
      payload: { starterIds: ['character-voice'] },
    });
    const installed = install.json<SkillMetadata[]>()[0];
    expect(installed).toBeDefined();

    await app.inject({
      method: 'PATCH',
      url: `/api/skills/${installed?.id ?? ''}`,
      payload: { name: 'voice-craft' },
    });

    const catalog = await app.inject({ method: 'GET', url: '/api/skills-starter' });
    const entry = catalog
      .json<Array<{ starterId: string; installed: boolean }>>()
      .find((starter) => starter.starterId === 'character-voice');
    expect(entry?.installed).toBe(true);

    const again = await app.inject({
      method: 'POST',
      url: '/api/skills-starter/install',
      payload: { starterIds: ['character-voice'] },
    });
    expect(again.statusCode).toBe(201);
    expect(again.json<SkillMetadata[]>()).toEqual([]);
  });

  it('serves an empty starter catalog when the vendored directory is absent', async () => {
    const emptyApp = buildApp({
      dataDir: mkdtempSync(join(tmpdir(), 'worldbookllm-skills-empty-')),
      logger: false,
      starterSkillsDir: join(tmpdir(), 'worldbookllm-does-not-exist'),
    });
    const listed = await emptyApp.inject({ method: 'GET', url: '/api/skills-starter' });
    expect(listed.json()).toEqual([]);
    await emptyApp.close();
  });

  it('parses and installs the real vendored catalog shipped with the server', async () => {
    // No starterSkillsDir override: this exercises apps/server/skills-starter,
    // guarding the vendored SKILL.md files against the shared schema limits.
    const vendoredDataDir = mkdtempSync(join(tmpdir(), 'worldbookllm-skills-vendored-'));
    tempDirs.push(vendoredDataDir);
    const vendoredApp = buildApp({ dataDir: vendoredDataDir, logger: false });

    const listed = await vendoredApp.inject({ method: 'GET', url: '/api/skills-starter' });
    expect(listed.statusCode).toBe(200);
    const starters = listed.json<Array<{ starterId: string; installed: boolean }>>();
    expect(starters.length).toBeGreaterThanOrEqual(16);
    expect(starters.map((entry) => entry.starterId)).toEqual(
      expect.arrayContaining(['story-sense', 'settlement-design', 'worldbuilding']),
    );

    const install = await vendoredApp.inject({
      method: 'POST',
      url: '/api/skills-starter/install',
      payload: { starterIds: starters.map((entry) => entry.starterId) },
    });
    expect(install.statusCode).toBe(201);
    expect(install.json<SkillMetadata[]>()).toHaveLength(starters.length);
    await vendoredApp.close();
  });
});
