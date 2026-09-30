import type { SeriesDrift, SeriesHealth, SeriesSummary } from '@worldbookllm/shared';

import { NotFoundError } from '../errors.js';
import type { BookService } from '../services/books.js';
import { identityDifferences, isSeriesEntityKind } from './series-fields.js';

/** Read-only series views over the same indexed, on-disk books as the book workspace. */
export class SeriesService {
  constructor(private readonly books: BookService) {}

  list(): SeriesSummary[] {
    const books = this.books.list();
    return books
      .filter((book) => book.kind === 'series-bible')
      .map((bible) => ({
        id: bible.slug,
        bible,
        books: books
          .filter((book) => book.kind === 'book' && book.seriesId === bible.slug)
          .sort(
            (a, b) =>
              (a.bookNumber ?? Infinity) - (b.bookNumber ?? Infinity) ||
              a.slug.localeCompare(b.slug),
          ),
      }));
  }

  get(id: string): SeriesSummary {
    const series = this.list().find((series) => series.id === id);
    if (series === undefined) throw new NotFoundError(`Series ${id} was not found`);
    return series;
  }

  drift(id: string): SeriesDrift[] {
    const series = this.get(id);
    const canon = this.books
      .tree(series.bible.slug)
      .files.filter((file) => isSeriesEntityKind(file.kind) && file.entityId !== null);
    const result: SeriesDrift[] = [];
    for (const book of series.books) {
      const copies = new Map(
        this.books.tree(book.slug).files.map((file) => [`${file.kind}:${file.entityId}`, file]),
      );
      for (const entity of canon) {
        if (!isSeriesEntityKind(entity.kind) || entity.entityId === null) continue;
        const copy = copies.get(`${entity.kind}:${entity.entityId}`);
        if (copy === undefined) continue;
        const fields = identityDifferences(
          entity.kind,
          this.books.readFile(series.bible.slug, entity.path).content,
          this.books.readFile(book.slug, copy.path).content,
        );
        if (fields.length > 0)
          result.push({
            entity: { kind: entity.kind, id: entity.entityId },
            book: book.slug,
            fields,
          });
      }
    }
    return result;
  }

  async health(id: string): Promise<SeriesHealth> {
    const series = this.get(id);
    // CLI series/links checks can read siblings. A book's own revision cannot key that cache.
    const checked = await this.books.check(
      series.books[0]?.slug ?? series.bible.slug,
      'series',
      true,
    );
    const links = [];
    for (const book of [series.bible, ...series.books]) {
      links.push({ book: book.slug, result: await this.books.check(book.slug, 'links', true) });
    }
    return { series: checked, links, drift: this.drift(id) };
  }
}
