import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';

let app: FastifyInstance;
let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'worldbookllm-series-health-'));
  app = buildApp({ dataDir, logger: false });
});
afterEach(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

async function fixture(): Promise<void> {
  await app.services.books.createSeries({ title: 'Tides' });
  await app.services.books.addToSeries('tides', { title: 'Low Water', bookNumber: 1 });
  await app.services.books.addToSeries('tides', {
    title: 'High Water',
    follows: 'low-water',
    bookNumber: 2,
  });
}

async function edit(book: string, path: string, content: string): Promise<void> {
  const current = app.services.books.readFile(book, path);
  await app.services.books.writeFile(book, path, { content, expectedHash: current.hash });
}

describe('series reads and health', () => {
  it('lists series with their bible and books without standalone books', async () => {
    await fixture();
    await app.services.books.create({ title: 'Standalone' });
    const response = await app.inject('/api/series');
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject([
      {
        id: 'tides',
        bible: { slug: 'tides', kind: 'series-bible' },
        books: [{ slug: 'low-water' }, { slug: 'high-water' }],
      },
    ]);
    const detail = await app.inject('/api/series/tides');
    expect(detail.statusCode, detail.body).toBe(200);
    expect(detail.json()).toEqual(response.json()[0]);
    const sequel = app.services.books.readFile('high-water', 'story.md').content;
    await edit('high-water', 'story.md', sequel.replace('book-number: 2', 'book-number: 1'));
    expect(
      (await app.inject('/api/series/tides'))
        .json()
        .books.map((book: { slug: string }) => book.slug),
    ).toEqual(['low-water', 'high-water']);
    expect((await app.inject('/api/series/standalone')).statusCode).toBe(404);
    expect((await app.inject('/api/series/no-such-series/drift')).statusCode).toBe(404);
    expect((await app.inject('/api/series/INVALID/health')).statusCode).toBe(400);
  });

  it('matches canon by kind and id and only reports identity differences for existing copies', async () => {
    await fixture();
    for (const book of ['tides', 'low-water', 'high-water']) {
      await app.services.books.addEntity(book, { kind: 'character', name: 'Mira', options: {} });
    }
    await app.services.books.addEntity('tides', {
      kind: 'character',
      name: 'Bible Only',
      options: {},
    });
    const path = 'characters/mira.md';
    const original = app.services.books.readFile('tides', path).content;
    await edit('tides', path, original.replace('aliases: []', 'aliases: [Captain]'));
    await edit(
      'high-water',
      path,
      original
        .replace('## Appearance', '## Appearance\nGreen eyes.')
        .replace('## Character Arc', '## Character Arc\nLocal arc.'),
    );
    const response = await app.inject('/api/series/tides/drift');
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual([
      { entity: { kind: 'character', id: 'mira' }, book: 'low-water', fields: ['aliases'] },
      {
        entity: { kind: 'character', id: 'mira' },
        book: 'high-water',
        fields: ['aliases', 'body:Appearance'],
      },
    ]);
    await edit(
      'high-water',
      path,
      app.services.books
        .readFile('tides', path)
        .content.replace('## Character Arc', '## Character Arc\nOnly local changes.'),
    );
    expect((await app.inject('/api/series/tides/drift')).json()).toEqual([
      { entity: { kind: 'character', id: 'mira' }, book: 'low-water', fields: ['aliases'] },
    ]);
  }, 30_000);

  it('returns actual upstream series and per-book links checks without checkpoints', async () => {
    await fixture();
    const before = app.services.books.listCheckpoints('low-water');
    const response = await app.inject('/api/series/tides/health');
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      series: { command: 'series', envelope: { command: 'series', apiVersion: 'story/v2' } },
      links: [
        { book: 'tides', result: { command: 'links' } },
        { book: 'low-water', result: { command: 'links' } },
        { book: 'high-water', result: { command: 'links' } },
      ],
      drift: [],
    });
    expect(app.services.books.listCheckpoints('low-water')).toEqual(before);
    const sequelStory = app.services.books.readFile('high-water', 'story.md').content;
    await edit(
      'high-water',
      'story.md',
      sequelStory.replace('title: High Water', 'title: Rising Water'),
    );
    const refreshed = await app.inject('/api/series/tides/health');
    expect(refreshed.statusCode, refreshed.body).toBe(200);
    expect(refreshed.json().series.envelope.data.books).toEqual(
      expect.arrayContaining([expect.objectContaining({ title: 'Rising Water' })]),
    );
  }, 30_000);
});
