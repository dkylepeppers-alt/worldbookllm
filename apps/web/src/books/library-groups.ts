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

function titleOrder(left: BookSummary, right: BookSummary): number {
  return left.title.localeCompare(right.title) || left.slug.localeCompare(right.slug);
}

/** Resolves follows/precedes inside one equal-number bucket with a stable title fallback. */
function linkedOrder(books: BookSummary[]): BookSummary[] {
  const bySlug = new Map(books.map((book) => [book.slug, book]));
  const successors = new Map(books.map((book) => [book.slug, new Set<string>()]));
  const indegree = new Map(books.map((book) => [book.slug, 0]));

  function addEdge(before: string, after: string) {
    if (before === after || !bySlug.has(before) || !bySlug.has(after)) return;
    const targets = successors.get(before)!;
    if (targets.has(after)) return;
    targets.add(after);
    indegree.set(after, (indegree.get(after) ?? 0) + 1);
  }

  for (const book of books) {
    for (const predecessor of book.follows) addEdge(predecessor, book.slug);
    for (const successor of book.precedes) addEdge(book.slug, successor);
  }

  const ready = books.filter((book) => indegree.get(book.slug) === 0).sort(titleOrder);
  const ordered: BookSummary[] = [];
  while (ready.length > 0) {
    const book = ready.shift()!;
    ordered.push(book);
    for (const successor of successors.get(book.slug) ?? []) {
      const remaining = (indegree.get(successor) ?? 0) - 1;
      indegree.set(successor, remaining);
      if (remaining === 0) {
        ready.push(bySlug.get(successor)!);
        ready.sort(titleOrder);
      }
    }
  }

  if (ordered.length === books.length) return ordered;
  const placed = new Set(ordered.map((book) => book.slug));
  return [...ordered, ...books.filter((book) => !placed.has(book.slug)).sort(titleOrder)];
}

/** Book number is primary; links resolve ties and unnumbered chronology. */
function readingOrder(books: BookSummary[]): BookSummary[] {
  const numbered = new Map<number, BookSummary[]>();
  const unnumbered: BookSummary[] = [];
  for (const book of books) {
    if (book.bookNumber === null) unnumbered.push(book);
    else numbered.set(book.bookNumber, [...(numbered.get(book.bookNumber) ?? []), book]);
  }
  return [
    ...[...numbered.entries()]
      .sort(([left], [right]) => left - right)
      .flatMap(([, bucket]) => linkedOrder(bucket)),
    ...linkedOrder(unnumbered),
  ];
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
  for (const group of series.values()) group.books = readingOrder(group.books);
  return {
    standalone,
    series: [...series.values()].sort((left, right) =>
      (left.bible?.title ?? left.id).localeCompare(right.bible?.title ?? right.id),
    ),
  };
}
