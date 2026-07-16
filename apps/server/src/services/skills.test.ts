import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import matter from 'gray-matter';
import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../db/database.js';
import { ConflictError, InvalidStoredDataError, NotFoundError } from '../errors.js';
import { SkillFileStore } from '../files/skill-files.js';
import { SkillService } from './skills.js';

const tempDirs: string[] = [];
const NOW = '2026-07-16T12:00:00.000Z';

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), 'worldbookllm-skills-'));
  tempDirs.push(dataDir);
  const db = openDatabase(dataDir);
  const skills = new SkillService(db, new SkillFileStore(dataDir), () => NOW);
  return { dataDir, db, skills };
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const input = {
  name: 'character-voice',
  description: 'Keep character voices distinct and consistent.',
  content: '# Character voice\n\nListen for each character.\n',
};

describe('SkillService', () => {
  it('creates, lists, and reads skills with file-backed content', () => {
    const { dataDir, skills } = setup();
    const created = skills.create(input);
    expect(created).toEqual({
      id: expect.any(String),
      name: 'character-voice',
      description: input.description,
      dirPath: 'skills/character-voice',
      origin: { type: 'created' },
      license: null,
      wordCount: 7,
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(existsSync(join(dataDir, 'skills/character-voice/SKILL.md'))).toBe(true);

    skills.create({ ...input, name: 'a-first-skill' });
    expect(skills.list().map((skill) => skill.name)).toEqual(['a-first-skill', 'character-voice']);
    expect(skills.get(created.id)).toEqual({ ...created, content: input.content });
  });

  it('rejects duplicate names with a conflict and leaves the original intact', () => {
    const { dataDir, skills } = setup();
    const created = skills.create(input);
    expect(() => skills.create({ ...input, description: 'Another' })).toThrow(ConflictError);
    expect(skills.get(created.id).description).toBe(input.description);
    expect(readFileSync(join(dataDir, 'skills/character-voice/SKILL.md'), 'utf8')).toContain(
      input.description,
    );
  });

  it('reconciles out-of-band file edits into the index on read (file wins)', () => {
    const { dataDir, skills } = setup();
    const created = skills.create(input);
    const skillPath = join(dataDir, created.dirPath, 'SKILL.md');
    const parsed = matter(readFileSync(skillPath, 'utf8'));
    writeFileSync(
      skillPath,
      matter
        .stringify('Hand-edited body', {
          ...parsed.data,
          description: 'Edited outside the app',
          updatedAt: '2026-07-16T13:00:00.000Z',
        })
        .replace(/\n$/u, ''),
      { mode: 0o600 },
    );

    const read = skills.get(created.id);
    expect(read.description).toBe('Edited outside the app');
    expect(read.content).toBe('Hand-edited body');
    expect(read.updatedAt).toBe('2026-07-16T13:00:00.000Z');
    expect(skills.list()[0]?.description).toBe('Edited outside the app');
  });

  it('refuses a file whose identity does not match its index row', () => {
    const { dataDir, skills } = setup();
    const created = skills.create(input);
    const skillPath = join(dataDir, created.dirPath, 'SKILL.md');
    const parsed = matter(readFileSync(skillPath, 'utf8'));
    writeFileSync(
      skillPath,
      matter
        .stringify(parsed.content, { ...parsed.data, id: '9c62ee9c-0f5f-4d33-9d61-1a2b3c4d5e6f' })
        .replace(/\n$/u, ''),
      { mode: 0o600 },
    );
    expect(() => skills.get(created.id)).toThrow(InvalidStoredDataError);
  });

  it('patches content in place and moves the directory on rename', () => {
    const { dataDir, skills } = setup();
    const created = skills.create(input);

    const edited = skills.patch(created.id, { content: 'New body\n' });
    expect(edited.contentHash).not.toBe(created.contentHash);
    expect(edited.dirPath).toBe(created.dirPath);

    const renamed = skills.patch(created.id, { name: 'voice-craft' });
    expect(renamed.name).toBe('voice-craft');
    expect(renamed.dirPath).toBe('skills/voice-craft');
    expect(renamed.createdAt).toBe(NOW);
    expect(renamed.origin).toEqual({ type: 'created' });
    expect(existsSync(join(dataDir, 'skills/character-voice'))).toBe(false);
    expect(readFileSync(join(dataDir, 'skills/voice-craft/SKILL.md'), 'utf8')).toContain(
      'New body',
    );
  });

  it('rejects a rename onto an existing name without touching either skill', () => {
    const { dataDir, skills } = setup();
    const first = skills.create(input);
    skills.create({ ...input, name: 'voice-craft' });
    expect(() => skills.patch(first.id, { name: 'voice-craft' })).toThrow(ConflictError);
    expect(skills.get(first.id).name).toBe('character-voice');
    expect(existsSync(join(dataDir, 'skills/character-voice/SKILL.md'))).toBe(true);
  });

  it('deletes the row and the whole directory', () => {
    const { dataDir, skills } = setup();
    const created = skills.create(input);
    writeFileSync(join(dataDir, created.dirPath, 'notes.md'), 'extra', { mode: 0o600 });
    skills.delete(created.id);
    expect(skills.list()).toEqual([]);
    expect(existsSync(join(dataDir, created.dirPath))).toBe(false);
    expect(() => skills.get(created.id)).toThrow(NotFoundError);
  });
});
