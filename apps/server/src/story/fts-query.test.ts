import { describe, expect, it } from 'vitest';

import { toFtsMatchQuery } from './fts-query.js';

describe('toFtsMatchQuery', () => {
  it('quotes tokens as prefix phrases joined with implicit AND', () => {
    expect(toFtsMatchQuery('iron compact')).toBe('"iron"* "compact"*');
    expect(toFtsMatchQuery('  spaced   out  ')).toBe('"spaced"* "out"*');
  });

  it('disarms FTS5 query syntax by quoting and doubling quotes', () => {
    expect(toFtsMatchQuery('NEAR(a')).toBe('"NEAR(a"*');
    expect(toFtsMatchQuery('-negated')).toBe('"-negated"*');
    expect(toFtsMatchQuery('say "hi"')).toBe('"say"* """hi"""*');
  });

  it('returns an empty string for blank input', () => {
    expect(toFtsMatchQuery('   ')).toBe('');
  });

  it('splits on NUL characters, which FTS5 rejects even inside quotes', () => {
    expect(toFtsMatchQuery('a\0b')).toBe('"a"* "b"*');
    expect(toFtsMatchQuery('\0')).toBe('');
  });
});
