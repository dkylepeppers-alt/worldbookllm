import type { BookSummary } from '@worldbookllm/shared';
import { describe, expect, it } from 'vitest';

import { groupLibrary } from './library-groups.js';

function summary(slug: string, title: string, extra: Partial<BookSummary> = {}): BookSummary {
  return {
    slug,
    title,
    genre: null,
    status: null,
    kind: 'book',
    seriesId: null,
    bookNumber: null,
    follows: [],
    precedes: [],
    counts: {},
    updatedAt: '2026-09-30T00:00:00.000Z',
    ...extra,
  };
}

describe('groupLibrary', () => {
  it('keeps standalone books and gathers each series behind its bible in reading order', () => {
    const groups = groupLibrary([
      summary('harbor', 'Harbor'),
      summary('high-water', 'High Water', { seriesId: 'tides', bookNumber: 2 }),
      summary('tides', 'Tides', { kind: 'series-bible', seriesId: 'tides' }),
      summary('interlude', 'An Interlude', { seriesId: 'tides' }),
      summary('low-water', 'Low Water', { seriesId: 'tides', bookNumber: 1 }),
      summary('ember', 'Ember', { kind: 'series-bible', seriesId: 'ember' }),
    ]);
    expect(groups.standalone.map((book) => book.slug)).toEqual(['harbor']);
    expect(groups.series.map((group) => [group.id, group.bible?.slug])).toEqual([
      ['ember', 'ember'],
      ['tides', 'tides'],
    ]);
    expect(groups.series[1]?.books.map((book) => book.slug)).toEqual([
      'low-water',
      'high-water',
      'interlude',
    ]);
  });

  it('still groups a series whose bible is missing', () => {
    const groups = groupLibrary([summary('ebb', 'Ebb', { seriesId: 'tides' })]);
    expect(groups.series).toEqual([
      { id: 'tides', bible: null, books: [expect.objectContaining({ slug: 'ebb' })] },
    ]);
  });

  it('uses series links before titles for books with the same number', () => {
    const books = [
      summary('last', 'Alpha', { seriesId: 'tides', follows: ['middle'] }),
      summary('first', 'Zulu', { seriesId: 'tides', precedes: ['middle'] }),
      summary('middle', 'Middle', {
        seriesId: 'tides',
        follows: ['first'],
        precedes: ['last'],
      }),
    ];

    const groups = groupLibrary(books);

    expect(groups.series[0]?.books.map((book) => book.slug)).toEqual(['first', 'middle', 'last']);
  });
});
