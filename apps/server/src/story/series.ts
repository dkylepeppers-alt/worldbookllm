import type {
  SeriesDrift,
  SeriesHealth,
  SeriesSummary,
  SeriesSyncInput,
  SeriesSyncResult,
} from '@worldbookllm/shared';
import { orderSeriesBooks } from '@worldbookllm/shared';

import { isDeepStrictEqual } from 'node:util';

import { ConflictError, NotFoundError } from '../errors.js';
import type { BookService } from '../services/books.js';
import { parseFrontmatter } from './book-index.js';
import {
  carryIdentity,
  mergeIdentity,
  identityDifferences,
  isSeriesEntityKind,
} from './series-fields.js';
import type { CheckpointActor } from './checkpoints.js';

/** The style sheet is series-wide: the bible's copy is canon for every book, compared and synced whole. */
const STYLE_SHEET = 'style-sheet.md';

/** Frontmatter fields that differ, then `body` if the prose differs. */
function styleSheetDifferences(bibleContent: string, bookContent: string): string[] {
  const bible = parseFrontmatter(bibleContent);
  const book = parseFrontmatter(bookContent);
  const keys = new Set([
    ...Object.keys(bible.frontmatter ?? {}),
    ...Object.keys(book.frontmatter ?? {}),
  ]);
  const fields = [...keys].filter(
    (key) => !isDeepStrictEqual(bible.frontmatter?.[key], book.frontmatter?.[key]),
  );
  if (bible.body.trim() !== book.body.trim()) fields.push('body');
  return fields;
}

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
        books: orderSeriesBooks(
          books.filter((book) => book.kind === 'book' && book.seriesId === bible.slug),
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
    const styleSheet = this.readStyleSheet(series.bible.slug);
    for (const book of series.books) {
      const local = this.readStyleSheet(book.slug);
      if (styleSheet !== null && local !== null) {
        const fields = styleSheetDifferences(styleSheet, local);
        if (fields.length > 0)
          result.push({
            entity: { kind: 'style-sheet', id: 'style-sheet' },
            book: book.slug,
            fields,
          });
      }
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

  async sync(
    id: string,
    input: SeriesSyncInput,
    actor: CheckpointActor = 'user',
    activeBook?: string,
  ): Promise<SeriesSyncResult> {
    const series = this.get(id);
    const targets = input.direction === 'push' ? [...new Set(input.books)] : [input.book];
    const assertMembers = () => {
      const current = this.get(id);
      for (const book of targets) {
        if (!current.books.some((member) => member.slug === book)) {
          throw new ConflictError('foreign_series_book', `${book} is not a book in series ${id}.`);
        }
      }
    };
    assertMembers();
    const label = `Series ${input.direction}: ${input.direction === 'seed' ? input.book : input.entity.id} → ${input.direction === 'pull' || input.direction === 'seed' ? id : targets.join(', ')}`;
    const checkpoints = await this.books.updateBooksAtomically(
      [series.bible.slug, ...targets],
      label,
      () => {
        assertMembers();
        const plans: Array<{ book: string; path: string; content: string }> = [];
        const find = (book: string, kind: string, entityId: string) =>
          this.books
            .tree(book)
            .files.find((file) => file.kind === kind && file.entityId === entityId);
        if (input.direction === 'seed') {
          for (const entity of this.books.tree(input.book).files) {
            if (
              !isSeriesEntityKind(entity.kind) ||
              entity.entityId === null ||
              find(id, entity.kind, entity.entityId)
            )
              continue;
            plans.push({
              book: id,
              path: entity.path,
              content: carryIdentity(
                entity.kind,
                this.books.readFile(input.book, entity.path).content,
                entity.entityId,
              ),
            });
          }
          return plans;
        }
        if (input.entity.kind === 'style-sheet') {
          if (input.direction === 'carry')
            throw new ConflictError(
              'entity_exists',
              'Every book already has a style sheet. Use push to update it.',
            );
          const source = this.readStyleSheet(input.direction === 'pull' ? input.book : id);
          if (source === null) throw new NotFoundError(`${STYLE_SHEET} was not found`);
          for (const book of input.direction === 'pull' ? [id] : targets) {
            if (this.readStyleSheet(book) !== source)
              plans.push({ book, path: STYLE_SHEET, content: source });
          }
          return plans;
        }
        const { kind, id: entityId } = input.entity;
        const sourceBook = input.direction === 'pull' ? input.book : id;
        const source = find(sourceBook, kind, entityId);
        if (source === undefined)
          throw new NotFoundError(`${kind} ${entityId} was not found in ${sourceBook}`);
        const content = this.books.readFile(sourceBook, source.path).content;
        const destinations = input.direction === 'pull' ? [id] : targets;
        for (const book of destinations) {
          const copy = find(book, kind, entityId);
          if (input.direction === 'carry') {
            if (copy !== undefined)
              throw new ConflictError(
                'entity_exists',
                `${kind} ${entityId} already exists in ${book}. Use push to update canon.`,
              );
            plans.push({
              book,
              path: source.path,
              content: carryIdentity(kind, content, entityId),
            });
          } else {
            if (copy === undefined)
              throw new NotFoundError(
                `${kind} ${entityId} was not found in ${book}. Carry it first.`,
              );
            const targetContent = this.books.readFile(book, copy.path).content;
            if (identityDifferences(kind, content, targetContent).length > 0) {
              plans.push({
                book,
                path: copy.path,
                content: mergeIdentity(kind, content, targetContent),
              });
            }
          }
        }
        return plans;
      },
      actor,
      activeBook,
    );
    return { checkpoints };
  }

  private readStyleSheet(book: string): string | null {
    return this.books.tree(book).files.some((file) => file.path === STYLE_SHEET)
      ? this.books.readFile(book, STYLE_SHEET).content
      : null;
  }
}
