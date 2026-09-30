import { describe, expect, it } from 'vitest';

import { createSkillSchema, patchSkillSchema, skillNameSchema } from './index.js';

describe('skill schemas', () => {
  it('enforces the agentskills.io name grammar', () => {
    for (const name of ['character-voice', 'a', 'x1', 'story-sense-2']) {
      expect(skillNameSchema.parse(name)).toBe(name);
    }
    for (const name of ['Character-Voice', '-leading', 'trailing-', 'double--hyphen', '', 'a b']) {
      expect(() => skillNameSchema.parse(name)).toThrow();
    }
    // The name doubles as a directory: Windows-reserved device names must fail
    // validation instead of erroring at mkdir time.
    for (const name of ['con', 'nul', 'aux', 'prn', 'com1', 'lpt9']) {
      expect(() => skillNameSchema.parse(name)).toThrow();
    }
    expect(skillNameSchema.parse('con-lang')).toBe('con-lang');
  });

  it('defaults creation origin/license and rejects blank content and empty patches', () => {
    const created = createSkillSchema.parse({
      name: 'character-voice',
      description: 'Voices',
      content: 'Body',
    });
    expect(created.origin).toEqual({ type: 'created' });
    expect(created.license).toBeNull();
    expect(() =>
      createSkillSchema.parse({ name: 'x', description: 'd', content: '  \n ' }),
    ).toThrow();
    expect(() => patchSkillSchema.parse({})).toThrow();
    expect(patchSkillSchema.parse({ description: 'New' })).toEqual({ description: 'New' });
  });
});
