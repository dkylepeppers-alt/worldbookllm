import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BEAT_SKILLS_PACKAGE, beatSkillsDir } from './beat-skills.js';

/** The hash of every file in apps/server/beat-skills, for each version. */
const RELEASED: Record<string, string> = {
  'beat-skills@1.0.0': '1e2d743f8636072d76f87d84161ba13989e97eee04dc5cd899b36e706a4d0636',
};

function files(dir: string): string[] {
  return readdirSync(dir)
    .flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : [path];
    })
    .sort();
}

describe('the beat writer skills', () => {
  it('bump their version whenever a file changes, so unedited installs move to the new text', () => {
    const dir = beatSkillsDir();
    const hash = createHash('sha256');
    for (const path of files(dir)) {
      hash.update(relative(dir, path).split('\\').join('/'));
      hash.update(readFileSync(path));
    }
    expect(
      RELEASED[BEAT_SKILLS_PACKAGE],
      'A beat writer skill changed: bump BEAT_SKILLS_PACKAGE and record the new hash here.',
    ).toBe(hash.digest('hex'));
  });

  it('stay small enough for the beat writer to read whole', () => {
    for (const path of files(beatSkillsDir())) {
      expect(readFileSync(path, 'utf8').length, path).toBeLessThanOrEqual(3_000);
    }
  });
});
