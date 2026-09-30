import { describe, expect, it } from 'vitest';

import { lineDiff } from './line-diff.js';

describe('lineDiff', () => {
  it('marks a created file as all added and a deleted one as all removed', () => {
    expect(lineDiff(null, 'a\nb\n')).toEqual([
      { kind: 'add', text: 'a' },
      { kind: 'add', text: 'b' },
    ]);
    expect(lineDiff('a\n', null)).toEqual([{ kind: 'del', text: 'a' }]);
  });

  it('pairs a changed line with its context', () => {
    expect(lineDiff('one\ntwo\nthree\n', 'one\n2\nthree\n')).toEqual([
      { kind: 'same', text: 'one' },
      { kind: 'del', text: 'two' },
      { kind: 'add', text: '2' },
      { kind: 'same', text: 'three' },
    ]);
  });

  it('folds unchanged runs beyond three lines of context', () => {
    const before = Array.from({ length: 20 }, (_, index) => `line ${index}`);
    const after = [...before];
    after[10] = 'changed';
    const diff = lineDiff(before.join('\n'), after.join('\n'));
    expect(diff[0]).toEqual({ kind: 'skip', count: 7 });
    expect(diff.filter((line) => line.kind === 'same')).toHaveLength(6);
    expect(diff.at(-1)).toEqual({ kind: 'skip', count: 6 });
    expect(diff).toContainEqual({ kind: 'del', text: 'line 10' });
    expect(diff).toContainEqual({ kind: 'add', text: 'changed' });
  });

  it('finds an insertion inside a repeated block', () => {
    expect(lineDiff('a\nb\na\nb\n', 'a\nb\nx\na\nb\n')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'same', text: 'b' },
      { kind: 'add', text: 'x' },
      { kind: 'same', text: 'a' },
      { kind: 'same', text: 'b' },
    ]);
  });
});
