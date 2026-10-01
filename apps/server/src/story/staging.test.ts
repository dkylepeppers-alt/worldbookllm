import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BookSummary } from '@worldbookllm/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app.js';
import { StagedBook } from './staging.js';
import { StoryCli } from './story-cli.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('StagedBook', () => {
  it('removes a copy that failed partway instead of leaving it in staging', () => {
    const stagingDir = mkdtempSync(join(tmpdir(), 'worldbookllm-staging-'));
    tempDirs.push(stagingDir);
    expect(() =>
      StagedBook.create('harbor', join(stagingDir, 'missing-book'), stagingDir, new StoryCli()),
    ).toThrow();
    expect(readdirSync(stagingDir)).toEqual([]);
  });

  it('restores a staged file whose write fails reindex', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'worldbookllm-staging-'));
    tempDirs.push(dataDir);
    const app = buildApp({ dataDir, logger: false });
    try {
      const { slug } = (
        await app.inject({ method: 'POST', url: '/api/books', payload: { title: 'Harbor' } })
      ).json<BookSummary>();
      await app.inject({
        method: 'POST',
        url: `/api/books/${slug}/entities`,
        payload: { kind: 'character', name: 'Mara Quill', options: {} },
      });
      const staged = StagedBook.create(
        slug,
        join(dataDir, 'projects', slug),
        join(dataDir, 'staging'),
        new StoryCli(),
      );
      const path = 'characters/mara-quill.md';
      const before = staged.readFile(path);
      await expect(
        staged.writeFile(
          path,
          before.content.replace(
            'name: Mara Quill',
            'name: Mara Quill\narc: Starts certain,\n  ends unsure.',
          ),
          before.hash,
        ),
      ).rejects.toThrow(/reindex/u);
      expect(staged.readFile(path).hash).toBe(before.hash);
      expect(staged.changes()).toEqual([]);
      staged.dispose();
    } finally {
      await app.close();
    }
  });

  it('also restores staged registries a failed reindex had already rewritten', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'worldbookllm-staging-'));
    tempDirs.push(dataDir);
    const app = buildApp({ dataDir, logger: false });
    try {
      const { slug } = (
        await app.inject({ method: 'POST', url: '/api/books', payload: { title: 'Harbor' } })
      ).json<BookSummary>();
      await app.inject({
        method: 'POST',
        url: `/api/books/${slug}/entities`,
        payload: { kind: 'character', name: 'Mara Quill', options: {} },
      });
      const cli = new StoryCli();
      const staged = StagedBook.create(
        slug,
        join(dataDir, 'projects', slug),
        join(dataDir, 'staging'),
        cli,
      );
      const root = join(dataDir, 'staging', readdirSync(join(dataDir, 'staging'))[0]!);
      const registry = readFileSync(join(root, 'characters/_index.md'), 'utf8');
      vi.spyOn(cli, 'runOrThrow').mockImplementation(() => {
        writeFileSync(join(root, 'characters/_index.md'), '# Half written\n');
        mkdirSync(join(root, 'notes'), { recursive: true });
        writeFileSync(join(root, 'notes/stray-registry.md'), '# New registry\n');
        return Promise.reject(new Error('story reindex timed out'));
      });
      const path = 'characters/mara-quill.md';
      const before = staged.readFile(path);
      await expect(
        staged.writeFile(path, before.content.replace('Mara Quill', 'Mara Venn'), before.hash),
      ).rejects.toThrow(/timed out/u);
      expect(staged.readFile(path).hash).toBe(before.hash);
      expect(readFileSync(join(root, 'characters/_index.md'), 'utf8')).toBe(registry);
      expect(existsSync(join(root, 'notes/stray-registry.md'))).toBe(false);
      staged.dispose();
    } finally {
      await app.close();
    }
  });
});
