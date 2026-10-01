import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BookSummary, Checkpoint } from '@worldbookllm/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import { ConflictError } from './errors.js';

let app: FastifyInstance;
let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'worldbookllm-series-'));
  app = buildApp({ dataDir, logger: false });
});

afterEach(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

async function post<T>(url: string, payload: unknown, status = 201): Promise<T> {
  const response = await app.inject({ method: 'POST', url, payload: payload as object });
  expect(response.statusCode, response.body).toBe(status);
  return response.json<T>();
}

function story(...segments: string[]): string {
  return readFileSync(join(dataDir, ...segments, 'story.md'), 'utf8');
}

async function history(slug: string): Promise<Checkpoint[]> {
  return (await app.inject({ method: 'GET', url: `/api/books/${slug}/checkpoints` })).json();
}

describe('series (ADR 0018)', () => {
  it('provides the explicit convert-to-series route while keeping the merged route compatible', async () => {
    await post('/api/books', { title: 'Harbor' });
    const response = await post<BookSummary>(
      '/api/books/harbor/convert-to-series',
      { title: 'Tides' },
      200,
    );
    expect(response).toMatchObject({ slug: 'harbor', seriesId: 'tides' });
  });

  it('refuses detachment while an affected sibling has a running agent turn', async () => {
    await post('/api/series', { title: 'Tides' });
    await post('/api/series/tides/books', { title: 'Harbor' });
    await app.inject({
      method: 'PATCH',
      url: '/api/app-settings',
      payload: {
        providerConfig: { source: 'openai', model: 'gpt-4o', baseUrl: 'http://provider.test/v1' },
      },
    });
    const chat = app.services.agent.createChat('harbor', {});
    const prepared = app.services.agent.prepare(chat.id, 'Hold this book', []);
    try {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/series/tides/books/harbor',
      });
      expect(response.statusCode).toBe(409);
      expect(existsSync(join(dataDir, 'series/tides/harbor/story.md'))).toBe(true);
    } finally {
      prepared.release();
    }
  });
  it('removes a book to projects, cleans sibling links, and preserves files and history', async () => {
    await post('/api/series', { title: 'Tides' });
    await post('/api/series/tides/books', { title: 'Low Water', bookNumber: 1 });
    await post('/api/series/tides/books', {
      title: 'High Water',
      follows: 'low-water',
      bookNumber: 2,
    });
    await app.services.books.writeFile('high-water', 'notes/keep.md', {
      content: '# Keep this\n',
      expectedHash: null,
    });
    const removal = await app.inject({
      method: 'DELETE',
      url: '/api/series/tides/books/high-water',
    });
    expect(removal.statusCode, removal.body).toBe(200);
    expect(removal.json()).toMatchObject({ slug: 'high-water', seriesId: null });
    expect(existsSync(join(dataDir, 'projects/high-water/story.md'))).toBe(true);
    expect(app.services.books.readFile('high-water', 'notes/keep.md').content).toBe(
      '# Keep this\n',
    );
    expect(story('projects/high-water')).not.toMatch(/^series:|^follows:|^book-number:/mu);
    expect(app.services.books.get('low-water').precedes).toEqual([]);
    expect((await history('high-water')).some((row) => row.label === 'Create notes/keep.md')).toBe(
      true,
    );
    expect(
      (await app.inject({ method: 'DELETE', url: '/api/series/tides/books/tides' })).statusCode,
    ).toBe(409);
  }, 30_000);

  it('refuses to undo series moves from history, since undo cannot move folders back', async () => {
    const harbor = await post<BookSummary>('/api/books', { title: 'Harbor' });
    await post(`/api/books/${harbor.slug}/series`, { newSeriesTitle: 'Tides' }, 200);
    await post('/api/series/tides/books', { title: 'High Water', follows: 'harbor' });
    const undo = async (book: string, label: string) => {
      const row = (await history(book)).find((entry) => entry.label === label);
      expect(row, `${book}: ${label}`).toBeDefined();
      return app.inject({
        method: 'POST',
        url: `/api/books/${book}/checkpoints/${row!.id}/undo`,
      });
    };

    await app.inject({ method: 'DELETE', url: '/api/series/tides/books/high-water' });
    for (const book of ['high-water', 'harbor']) {
      const refused = await undo(book, 'Leave series tides: high-water');
      expect(refused.statusCode, refused.body).toBe(409);
      expect(refused.json()).toMatchObject({ error: 'checkpoint_structural' });
    }
    expect(story('projects/high-water')).not.toMatch(/^series:/mu);

    const joined = await undo('harbor', 'Join series tides');
    expect(joined.json()).toMatchObject({ error: 'checkpoint_structural' });
    expect(story('series/tides/harbor')).toMatch(/^series: tides$/mu);
  }, 30_000);

  it('reports duplicate disk slugs without exposing server paths or opening the later copy', async () => {
    await post('/api/series', { title: 'Tides' });
    await post('/api/series/tides/books', { title: 'Harbor' });
    // A separate project with the same slug simulates a writer copying folders outside the app.
    const { cpSync, mkdirSync } = await import('node:fs');
    mkdirSync(join(dataDir, 'projects/harbor'), { recursive: true });
    cpSync(join(dataDir, 'series/tides/harbor'), join(dataDir, 'projects/harbor'), {
      recursive: true,
    });
    const conflicts = await app.inject('/api/books/conflicts');
    expect(conflicts.statusCode, conflicts.body).toBe(200);
    expect(conflicts.json()).toEqual([
      { slug: 'harbor', path: 'series/tides/harbor', seriesId: 'tides', kind: 'book' },
    ]);
    expect(app.services.books.get('harbor').seriesId).toBe(null);
  }, 30_000);
  it('creates a series whose bible is addressed by the series id', async () => {
    const bible = await post<BookSummary>('/api/series', { title: 'Tides' });
    expect(bible).toMatchObject({
      slug: 'tides',
      title: 'Tides',
      kind: 'series-bible',
      seriesId: 'tides',
    });
    expect(story('series/tides/series-bible')).toContain('series: tides');

    const books = (await app.inject({ method: 'GET', url: '/api/books' })).json<BookSummary[]>();
    expect(books.map((book) => [book.slug, book.kind])).toEqual([['tides', 'series-bible']]);
    const tree = await app.inject({ method: 'GET', url: '/api/books/tides/files/story.md' });
    expect(tree.statusCode).toBe(200);
  });

  it('adds books linked in order, recording the sibling’s link as an undoable checkpoint', async () => {
    await post('/api/series', { title: 'Tides' });
    const first = await post<BookSummary>('/api/series/tides/books', {
      title: 'Low Water',
      bookNumber: 1,
    });
    expect(first).toMatchObject({
      slug: 'low-water',
      kind: 'book',
      seriesId: 'tides',
      bookNumber: 1,
    });

    const second = await post<BookSummary>('/api/series/tides/books', {
      title: 'High Water',
      follows: 'low-water',
      bookNumber: 2,
    });
    expect(second.slug).toBe('high-water');
    expect(story('series/tides/high-water')).toContain('../low-water');
    expect(story('series/tides/low-water')).toContain('../high-water');
    const listed = (await app.inject({ method: 'GET', url: '/api/books' })).json<
      Array<Record<string, unknown>>
    >();
    expect(listed.find((book) => book.slug === 'low-water')).toMatchObject({
      follows: [],
      precedes: ['high-water'],
    });
    expect(listed.find((book) => book.slug === 'high-water')).toMatchObject({
      follows: ['low-water'],
      precedes: [],
    });

    const [link] = await history('low-water');
    expect(link?.label).toBe('Link High Water');
    const undo = await app.inject({
      method: 'POST',
      url: `/api/books/low-water/checkpoints/${link!.id}/undo`,
    });
    expect(undo.statusCode, undo.body).toBe(200);
    expect(story('series/tides/low-water')).not.toContain('../high-water');
  });

  it('shares one style sheet: a new series bible adopts the converted book’s, new books start from the bible’s', async () => {
    const book = await post<BookSummary>('/api/books', { title: 'Harbor' });
    const own = app.services.books.readFile(book.slug, 'style-sheet.md');
    await app.services.books.writeFile(book.slug, 'style-sheet.md', {
      content: own.content.replace('watch-words: []', 'watch-words:\n  - "suddenly"'),
      expectedHash: own.hash,
    });
    const house = app.services.books.readFile(book.slug, 'style-sheet.md').content;
    await post(`/api/books/${book.slug}/series`, { newSeriesTitle: 'Tides' }, 200);
    expect(app.services.books.readFile('tides', 'style-sheet.md').content).toBe(house);

    const sequel = await post<BookSummary>('/api/series/tides/books', {
      title: 'High Water',
      follows: 'harbor',
    });
    expect(app.services.books.readFile(sequel.slug, 'style-sheet.md').content).toBe(house);
  });

  it('moves a standalone book into a series and keeps its history', async () => {
    const book = await post<BookSummary>('/api/books', { title: 'Harbor' });
    const moved = await post<BookSummary>(
      `/api/books/${book.slug}/series`,
      { newSeriesTitle: 'Tides' },
      200,
    );
    expect(moved).toMatchObject({ slug: 'harbor', seriesId: 'tides', kind: 'book' });
    expect(existsSync(join(dataDir, 'projects/harbor'))).toBe(false);
    expect(story('series/tides/harbor')).toMatch(/^series: tides$/mu);

    const [join_] = await history('harbor');
    expect(join_?.label).toBe('Join series tides');
    const read = await app.inject({ method: 'GET', url: '/api/books/harbor/files/story.md' });
    expect(read.statusCode).toBe(200);

    const again = await app.inject({
      method: 'POST',
      url: '/api/books/harbor/series',
      payload: { seriesId: 'tides' },
    });
    expect(again.statusCode).toBe(409);
  });

  it('keeps slugs unique across books and series, and refuses foreign anchors', async () => {
    await post('/api/series', { title: 'Tides' });
    const book = await post<BookSummary>('/api/books', { title: 'Tides' });
    expect(book.slug).toBe('tides-2');

    await post('/api/series', { title: 'Ember' });
    await post('/api/series/ember/books', { title: 'Spark' });
    const foreign = await app.inject({
      method: 'POST',
      url: '/api/series/tides/books',
      payload: { title: 'Ebb', follows: 'spark' },
    });
    expect(foreign.statusCode).toBe(409);

    const missing = await app.inject({
      method: 'POST',
      url: '/api/series/nowhere/books',
      payload: { title: 'Ebb' },
    });
    expect(missing.statusCode).toBe(404);
    const notSeries = await app.inject({
      method: 'POST',
      url: '/api/series/tides-2/books',
      payload: { title: 'Ebb' },
    });
    expect(notSeries.statusCode).toBe(404);
  });

  it('only links a new book to a book of the series, never to its bible', async () => {
    await post('/api/series', { title: 'Tides' });
    const bible = await app.inject({
      method: 'POST',
      url: '/api/series/tides/books',
      payload: { title: 'Ebb', follows: 'tides' },
    });
    expect(bible.statusCode).toBe(409);
  });

  it('refuses to link a new book to one whose agent turn is running', async () => {
    await post('/api/series', { title: 'Tides' });
    await post('/api/series/tides/books', { title: 'Low Water' });
    app.services.books.attachChatLifecycle({
      assertIdle: (book, action) => {
        if (book === 'low-water')
          throw new ConflictError('generation_in_progress', `busy: ${action}`);
      },
      removeForBook: () => undefined,
    });
    const refused = await app.inject({
      method: 'POST',
      url: '/api/series/tides/books',
      payload: { title: 'High Water', follows: 'low-water' },
    });
    expect(refused.statusCode).toBe(409);
    expect(existsSync(join(dataDir, 'series/tides/high-water'))).toBe(false);
    expect(story('series/tides/low-water')).not.toContain('high-water');
  });

  it('leaves no new series behind when the move is refused', async () => {
    await post('/api/series', { title: 'Tides' });
    await post('/api/series/tides/books', { title: 'Low Water' });
    const refused = await app.inject({
      method: 'POST',
      url: '/api/books/low-water/series',
      payload: { newSeriesTitle: 'Another' },
    });
    expect(refused.statusCode).toBe(409);
    expect(existsSync(join(dataDir, 'series/another'))).toBe(false);
    const books = (await app.inject({ method: 'GET', url: '/api/books' })).json<BookSummary[]>();
    expect(books.map((book) => book.slug).sort()).toEqual(['low-water', 'tides']);
  });

  it('keeps series books and bibles out of the trash until removal is series-aware', async () => {
    await post('/api/series', { title: 'Tides' });
    await post('/api/series/tides/books', { title: 'Low Water' });
    for (const slug of ['tides', 'low-water']) {
      const trashed = await app.inject({ method: 'DELETE', url: `/api/books/${slug}` });
      expect(trashed.statusCode).toBe(409);
      expect(trashed.json<{ error: string }>().error).toBe('in_series');
    }
    const standalone = await post<BookSummary>('/api/books', { title: 'Harbor' });
    const trashed = await app.inject({ method: 'DELETE', url: `/api/books/${standalone.slug}` });
    expect(trashed.statusCode).toBe(204);
  });
});
