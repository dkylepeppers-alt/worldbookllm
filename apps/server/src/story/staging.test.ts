import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

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
});
