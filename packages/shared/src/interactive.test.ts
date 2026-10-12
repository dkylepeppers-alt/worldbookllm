import { describe, expect, it } from 'vitest';

import { closingChoiceSchema, inkTargetSchema } from './interactive.js';

describe('chapter ending schemas', () => {
  it('take a knot, a knot.stitch, END, or DONE as a target', () => {
    for (const target of ['chapter_03', '_1_prologue', 'chapter_03.cellar', 'END', 'DONE']) {
      expect(inkTargetSchema.safeParse(target).success, target).toBe(true);
    }
    for (const target of ['chapter-03', 'a.b.c', '3x', '', '-> x']) {
      expect(inkTargetSchema.safeParse(target).success, target).toBe(false);
    }
  });

  it('keep a choice, its condition, and its effects to one line each', () => {
    const choice = {
      text: 'Go',
      once: false,
      condition: 'trust > 1',
      effects: ['trust += 1'],
      to: 'END',
    };
    expect(closingChoiceSchema.safeParse(choice).success).toBe(true);
    expect(closingChoiceSchema.safeParse({ ...choice, text: 'a\nb' }).success).toBe(false);
    expect(closingChoiceSchema.safeParse({ ...choice, condition: 'a\nb' }).success).toBe(false);
    expect(closingChoiceSchema.safeParse({ ...choice, effects: [''] }).success).toBe(false);
  });
});
