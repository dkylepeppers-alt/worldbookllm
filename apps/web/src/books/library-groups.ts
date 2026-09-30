import type { BookSummary } from '@worldbookllm/shared';

interface SeriesGroup {
  id: string;
  /** The series bible, addressed by the series id; null if its folder has no story.md. */
  bible: BookSummary | null;
  /** The series' books in reading order. */
  books: BookSummary[];
}

export interface LibraryGroups {
  standalone: BookSummary[];
  series: SeriesGroup[];
}

function readingOrder(left: BookSummary, right: BookSummary): number {
  const a = left.bookNumber ?? Number.POSITIVE_INFINITY;
  const b = right.bookNumber ?? Number.POSITIVE_INFINITY;
  return a === b ? left.title.localeCompare(right.title) : a - b;
}

/** Splits the library into standalone books and series, each series with its bible first. */
export function groupLibrary(books: readonly BookSummary[]): LibraryGroups {
  const standalone: BookSummary[] = [];
  const series = new Map<string, SeriesGroup>();
  for (const book of books) {
    if (book.seriesId === null) {
      standalone.push(book);
      continue;
    }
    const group = series.get(book.seriesId) ?? { id: book.seriesId, bible: null, books: [] };
    if (book.kind === 'series-bible') group.bible = book;
    else group.books.push(book);
    series.set(book.seriesId, group);
  }
  for (const group of series.values()) group.books.sort(readingOrder);
  return {
    standalone,
    series: [...series.values()].sort((left, right) =>
      (left.bible?.title ?? left.id).localeCompare(right.bible?.title ?? right.id),
    ),
  };
}
