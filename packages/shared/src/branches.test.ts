import { describe, expect, it } from 'vitest';

import { chapterIdSchema, choiceStateEntrySchema } from './branches.js';

describe('choice state entries', () => {
  it('take flag names, any chapter id, and either with "not"', () => {
    for (const entry of [
      'found_coat',
      '_hidden',
      'not lamp_lit',
      'chapter-03',
      '1-prologue',
      'not 1-prologue',
      '01',
    ]) {
      expect(choiceStateEntrySchema.safeParse(entry).success, entry).toBe(true);
    }
    expect(chapterIdSchema.safeParse('1-prologue').success).toBe(true);
  });

  it('refuse what is neither a flag nor a chapter id', () => {
    // A bare `not` is shaped like a name; the server refuses it as a word ink reserves.
    for (const entry of ['', 'has space', 'lamp!', '-chapter', 'a.b', 'not has space']) {
      expect(choiceStateEntrySchema.safeParse(entry).success, entry).toBe(false);
    }
  });
});
