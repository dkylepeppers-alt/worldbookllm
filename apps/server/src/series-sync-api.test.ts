import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';

let app: FastifyInstance;
let dataDir: string;
const entity = { kind: 'character', id: 'mira' };
const path = 'characters/mira.md';

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'worldbookllm-series-sync-'));
  app = buildApp({ dataDir, logger: false });
  await app.services.books.createSeries({ title: 'Tides' });
  await app.services.books.addToSeries('tides', { title: 'Low Water' });
  await app.services.books.addToSeries('tides', { title: 'High Water' });
  await app.services.books.addEntity('tides', { kind: 'character', name: 'Mira', options: {} });
}, 30_000);
afterEach(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

async function copy(book: string, role = 'protagonist'): Promise<void> {
  const content = app.services.books
    .readFile('tides', path)
    .content.replace('role: supporting', `role: ${role}`);
  await app.services.books.writeFile(book, path, { content, expectedHash: null });
}
async function alias(book: string, name: string): Promise<void> {
  const current = app.services.books.readFile(book, path);
  await app.services.books.writeFile(book, path, {
    content: current.content.replace('aliases: []', `aliases: [${name}]`),
    expectedHash: current.hash,
  });
}
async function sync(payload: unknown, expected = 200) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/series/tides/sync',
    payload: payload as object,
  });
  expect(response.statusCode, response.body).toBe(expected);
  return response;
}
function snapshot(book: string): Array<[string, string]> {
  return app.services.books
    .tree(book)
    .files.map((file) => [file.path, app.services.books.readFile(book, file.path).content]);
}

describe('atomic series sync', () => {
  it('pushes canon to selected books, preserving state and giving each its own undo', async () => {
    await copy('low-water');
    await copy('high-water');
    await alias('tides', 'Captain');
    const response = await sync({ direction: 'push', entity, books: ['low-water', 'high-water'] });
    const checkpoints = response.json().checkpoints as Array<{
      book: string;
      id: string;
      label: string;
    }>;
    expect(checkpoints.map((row) => row.book).sort()).toEqual(['high-water', 'low-water']);
    expect(new Set(checkpoints.map((row) => row.label)).size).toBe(1);
    for (const book of ['low-water', 'high-water']) {
      expect(app.services.books.readFile(book, path).frontmatter).toMatchObject({
        aliases: ['Captain'],
        role: 'protagonist',
      });
    }
    const checkpoint = checkpoints.find((row) => row.book === 'low-water')!;
    await app.services.books.undo('low-water', checkpoint.id);
    expect(app.services.books.readFile('low-water', path).frontmatter?.aliases).toEqual([]);
    expect(app.services.books.readFile('high-water', path).frontmatter?.aliases).toEqual([
      'Captain',
    ]);
  }, 30_000);

  it('pulls canon into the bible without adopting the book’s local state', async () => {
    await copy('low-water');
    await alias('low-water', 'Queen');
    await sync({ direction: 'pull', entity, book: 'low-water' });
    expect(app.services.books.readFile('tides', path).frontmatter).toMatchObject({
      aliases: ['Queen'],
      role: 'supporting',
    });
  }, 30_000);

  it('carries a new identity copy and refuses to overwrite an existing entity', async () => {
    await alias('tides', 'Captain');
    await sync({ direction: 'carry', entity, book: 'low-water' });
    expect(app.services.books.readFile('low-water', path).frontmatter).toMatchObject({
      aliases: ['Captain'],
      role: 'supporting',
      status: 'alive',
    });
    await sync({ direction: 'carry', entity, book: 'low-water' }, 409);
    expect(app.services.books.listCheckpoints('high-water')).toEqual([]);
  }, 30_000);

  it('seeds missing identities without replacing bible entities or copying local-only kinds', async () => {
    await app.services.books.addEntity('low-water', {
      kind: 'character',
      name: 'New Hero',
      options: { role: 'antagonist' },
    });
    await app.services.books.addEntity('low-water', {
      kind: 'arc',
      name: 'Local Arc',
      options: {},
    });
    await copy('low-water');
    await alias('low-water', 'Not Canon');
    await sync({ direction: 'seed', book: 'low-water' });
    expect(app.services.books.readFile('tides', 'characters/new-hero.md').frontmatter?.role).toBe(
      'supporting',
    );
    expect(app.services.books.readFile('tides', path).frontmatter?.aliases).toEqual([]);
    expect(app.services.books.tree('tides').files.some((file) => file.kind === 'arc')).toBe(false);
  }, 30_000);

  it('keeps the style sheet as series canon: whole-file drift, push, and pull', async () => {
    const styleSheet = { kind: 'style-sheet', id: 'style-sheet' };
    const bible = app.services.books.readFile('tides', 'style-sheet.md');
    await app.services.books.writeFile('tides', 'style-sheet.md', {
      content: bible.content.replace('watch-words: []', 'watch-words:\n  - "suddenly"'),
      expectedHash: bible.hash,
    });
    const drift = (await app.inject({ method: 'GET', url: '/api/series/tides/drift' })).json<
      Array<{ entity: unknown; book: string; fields: string[] }>
    >();
    expect(drift.filter((row) => row.book === 'low-water')).toEqual([
      { entity: styleSheet, book: 'low-water', fields: ['watch-words'] },
    ]);

    await sync({ direction: 'push', entity: styleSheet, books: ['low-water', 'high-water'] });
    const canon = app.services.books.readFile('tides', 'style-sheet.md').content;
    for (const book of ['low-water', 'high-water']) {
      expect(app.services.books.readFile(book, 'style-sheet.md').content).toBe(canon);
    }
    expect((await app.inject({ method: 'GET', url: '/api/series/tides/drift' })).json()).toEqual(
      [],
    );

    const local = app.services.books.readFile('low-water', 'style-sheet.md');
    await app.services.books.writeFile('low-water', 'style-sheet.md', {
      content: `${local.content}\nOxford comma, always.\n`,
      expectedHash: local.hash,
    });
    await sync({ direction: 'pull', entity: styleSheet, book: 'low-water' });
    expect(app.services.books.readFile('tides', 'style-sheet.md').content).toContain(
      'Oxford comma, always.',
    );
    await sync({ direction: 'carry', entity: styleSheet, book: 'high-water' }, 409);
    await sync(
      { direction: 'push', entity: { kind: 'style-sheet', id: 'foo' }, books: ['low-water'] },
      400,
    );
  }, 30_000);

  it('rolls back every touched book and creates no checkpoints if one validate fails', async () => {
    await copy('low-water');
    await copy('high-water', 'not-a-role');
    await alias('tides', 'Captain');
    const before = new Map(['low-water', 'high-water'].map((book) => [book, snapshot(book)]));
    const histories = new Map(
      ['low-water', 'high-water'].map((book) => [book, app.services.books.listCheckpoints(book)]),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/api/series/tides/sync',
      payload: { direction: 'push', entity, books: ['low-water', 'high-water'] },
    });
    expect(response.statusCode, response.body).toBe(422);
    for (const book of ['low-water', 'high-water']) {
      expect(snapshot(book)).toEqual(before.get(book));
      expect(app.services.books.listCheckpoints(book)).toEqual(histories.get(book));
    }
  }, 30_000);

  it('refuses foreign targets and missing copies before writing any book', async () => {
    await app.services.books.create({ title: 'Foreign' });
    await copy('low-water');
    const before = snapshot('low-water');
    await sync({ direction: 'push', entity, books: ['low-water', 'foreign'] }, 409);
    await sync({ direction: 'push', entity, books: ['low-water', 'high-water'] }, 404);
    expect(snapshot('low-water')).toEqual(before);
  }, 30_000);
});
