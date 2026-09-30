import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { SkillMetadata } from '@worldbookllm/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';

const tempDirs: string[] = [];
let app: FastifyInstance;
let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'worldbookllm-skills-api-'));
  tempDirs.push(dataDir);
  app = buildApp({ dataDir, logger: false });
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
});
