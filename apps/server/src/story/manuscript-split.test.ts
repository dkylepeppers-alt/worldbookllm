import { existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { looksLikeSeveralChapters, splitManuscript } from './manuscript-split.js';
import { StoryCli } from './story-cli.js';

const cli = new StoryCli();
const leftovers = () =>
  readdirSync(tmpdir()).filter((name) => name.startsWith('worldbookllm-split-'));

describe('splitManuscript', () => {
  it('splits one manuscript on its chapter headings, prologue unnumbered', async () => {
    const before = leftovers();
    const split = await splitManuscript(
      cli,
      [
        {
          name: 'draft.md',
          text: '# Prologue\n\nThe storm.\n\n# Chapter 1: Arrival\n\nMara docked. Mara Quill waved. Mara Quill ran.\n\n# Chapter 2\n\nMara Quill slept.\n',
        },
      ],
      { title: 'Draft' },
    );
    expect(
      split.chapters.map(({ title, numbered, source }) => ({ title, numbered, source })),
    ).toEqual([
      { title: 'Prologue', numbered: false, source: 'draft.md' },
      { title: 'Arrival', numbered: true, source: 'draft.md' },
      { title: 'Chapter 3', numbered: true, source: 'draft.md' },
    ]);
    expect(split.chapters[1]?.markdown).toBe('Mara docked. Mara Quill waved. Mara Quill ran.');
    expect(split.candidates).toContainEqual({ name: 'Mara Quill', count: 3 });
    expect(leftovers()).toEqual(before);
  });

  it('splits each document on its own, so every chapter knows its file', async () => {
    const split = await splitManuscript(
      cli,
      [
        { name: 'one.md', text: '# Chapter 1\n\nOne.\n\n# Chapter 2\n\nTwo.\n' },
        { name: 'three.txt', text: 'Three.\n' },
      ],
      { title: 'Parts' },
    );
    expect(split.chapters.map((chapter) => [chapter.source, chapter.markdown])).toEqual([
      ['one.md', 'One.'],
      ['one.md', 'Two.'],
      ['three.txt', 'Three.'],
    ]);
    expect(existsSync(tmpdir())).toBe(true);
  });

  it('spots documents with several chapter headings', () => {
    expect(looksLikeSeveralChapters('# Chapter 1\n\nA\n\nChapter 2\n\nB')).toBe(true);
    expect(looksLikeSeveralChapters('# Harbor notes\n\nThe chapter house.')).toBe(false);
  });
});
