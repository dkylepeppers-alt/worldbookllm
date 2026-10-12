import { describe, expect, it } from 'vitest';

import { inkPitfalls, inkStartLine } from './ink-text.js';

const chapter = [
  '---',
  'title: Harbor Wall',
  '---',
  '',
  '## Outline',
  '',
  '1. See https://example.org for the tide tables',
  '',
  '## Chapter Text',
  '',
  'See https://example.org now.',
  'Escaped https:\\/\\/example.org is fine.',
].join('\n');

describe('ink text', () => {
  it('finds where a chapter or an ink/ file starts its ink', () => {
    expect(inkStartLine(chapter, 'chapter')).toBe(10);
    expect(inkStartLine('---\ntitle: Variables\n---\nVAR x = 1\n', 'ink')).toBe(4);
    expect(inkStartLine('No heading.\n-> END\n', 'chapter')).toBe(1);
  });

  it('warns about a web address in the ink, not in the planning or when escaped', () => {
    expect(inkPitfalls(chapter, 'chapter')).toEqual([
      expect.objectContaining({ line: 11, from: 'See https:'.length }),
    ]);
  });
});
