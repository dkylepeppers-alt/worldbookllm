import { describe, expect, it } from 'vitest';

import {
  createSkillSchema,
  patchSkillSchema,
  presetGenerationContextSchema,
  skillNameSchema,
} from './index.js';

const VALID_CONTEXT_WITHOUT_SKILLS = {
  contextVersion: 2,
  preset: {
    id: '786f38a3-6ee4-493f-a6af-7a28e53c9a29',
    schemaVersion: 1,
    name: 'Preset',
    generation: { temperature: 0.7, topP: null, maxTokens: null, assistantPrefill: null },
    modules: [
      {
        key: 'sources',
        name: 'Sources',
        kind: 'sources',
        role: 'system',
        content: null,
        enabled: true,
        insertion: { position: 'before_history' },
      },
    ],
    createdAt: '2026-07-16T12:00:00.000Z',
    updatedAt: '2026-07-16T12:00:00.000Z',
  },
  canonicalMessages: [{ role: 'user', content: 'Question' }],
  sources: [],
  requestedControls: { temperature: 0.7, topP: null, maxTokens: null, assistantPrefill: null },
  effectiveRequestBody: {},
  provider: 'custom',
  model: 'local',
};

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

  it('keeps exchange snapshots authored before skills existed valid', () => {
    expect(
      presetGenerationContextSchema.parse(VALID_CONTEXT_WITHOUT_SKILLS).skills,
    ).toBeUndefined();

    const withSkills = presetGenerationContextSchema.parse({
      ...VALID_CONTEXT_WITHOUT_SKILLS,
      skills: [
        {
          id: '2f1f6c15-9a71-4f5e-8f43-25c9d16f2a01',
          name: 'character-voice',
          description: 'Voices',
          contentHash: 'a'.repeat(64),
          content: 'Body',
        },
      ],
    });
    expect(withSkills.skills).toHaveLength(1);
  });
});
