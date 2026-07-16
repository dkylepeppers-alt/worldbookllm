import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import matter from 'gray-matter';
import { afterEach, describe, expect, it } from 'vitest';

import { InvalidStoredDataError, UnsafePathError } from '../errors.js';
import { SkillFileStore } from './skill-files.js';

const tempDirs: string[] = [];

function makeStore(): SkillFileStore {
  const directory = mkdtempSync(join(tmpdir(), 'worldbookllm-skill-files-'));
  tempDirs.push(directory);
  return new SkillFileStore(directory);
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const input = {
  id: '4f4e2f9e-64ba-4a1d-9df7-3c4f6f5f2f10',
  name: 'character-voice',
  description: 'Keep character voices distinct and consistent.',
  content: '# Character voice\n\nListen for each character.\n',
  origin: { type: 'created' as const },
  license: null,
  createdAt: '2026-07-16T12:00:00.000Z',
};

describe('SkillFileStore', () => {
  it('writes SKILL.md under skills/<name> and round-trips frontmatter', () => {
    const store = makeStore();
    const stored = store.write(input);

    expect(stored.dirPath).toBe('skills/character-voice');
    expect(stored.wordCount).toBe(7);
    expect(stored.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(stored.updatedAt).toBe(input.createdAt);

    const raw = readFileSync(join(store.dataDir, 'skills/character-voice/SKILL.md'), 'utf8');
    const parsed = matter(raw);
    expect(parsed.data).toMatchObject({
      name: input.name,
      description: input.description,
      id: input.id,
      origin: { type: 'created' },
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    });
    expect(parsed.data).not.toHaveProperty('license');
    expect(parsed.content).toBe(input.content);

    const read = store.read(stored.dirPath);
    expect(read).toEqual({
      ...input,
      updatedAt: input.createdAt,
      wordCount: stored.wordCount,
      contentHash: stored.contentHash,
    });
  });

  it('keeps a bundled origin and license through the round trip', () => {
    const store = makeStore();
    const stored = store.write({
      ...input,
      name: 'settlement-design',
      origin: { type: 'bundled', starterId: 'settlement-design' },
      license: 'MIT',
    });
    const read = store.read(stored.dirPath);
    expect(read.origin).toEqual({ type: 'bundled', starterId: 'settlement-design' });
    expect(read.license).toBe('MIT');
  });

  it('rejects paths that escape the data directory', () => {
    const store = makeStore();
    expect(() => store.read('../outside')).toThrow(UnsafePathError);
    expect(() => store.remove('../outside')).toThrow(UnsafePathError);
    expect(() => store.move('../outside', 'skills/x')).toThrow(UnsafePathError);
  });

  it('wraps unreadable or invalid SKILL.md files as invalid stored data', () => {
    const store = makeStore();
    expect(() => store.read('skills/missing')).toThrow(InvalidStoredDataError);
    const stored = store.write(input);
    writeFileSync(join(store.dataDir, stored.dirPath, 'SKILL.md'), '---\nname: 1\n---\nbody', {
      mode: 0o600,
    });
    expect(() => store.read(stored.dirPath)).toThrow(InvalidStoredDataError);
  });

  it('moves a whole directory, carrying extra files along', () => {
    const store = makeStore();
    const stored = store.write(input);
    writeFileSync(join(store.dataDir, stored.dirPath, 'notes.md'), 'extra', { mode: 0o600 });

    store.move(stored.dirPath, 'skills/voice-craft');
    expect(existsSync(join(store.dataDir, 'skills/character-voice'))).toBe(false);
    expect(readFileSync(join(store.dataDir, 'skills/voice-craft/notes.md'), 'utf8')).toBe('extra');
  });

  it('removes the whole skill directory', () => {
    const store = makeStore();
    const stored = store.write(input);
    writeFileSync(join(store.dataDir, stored.dirPath, 'notes.md'), 'extra', { mode: 0o600 });
    store.remove(stored.dirPath);
    expect(existsSync(join(store.dataDir, stored.dirPath))).toBe(false);
    store.remove(stored.dirPath);
  });
});
