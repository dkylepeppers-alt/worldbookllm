import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BookFileStore } from './book-files.js';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'worldbookllm-store-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

function book(...segments: string[]): void {
  const root = join(dataDir, ...segments);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'story.md'), '---\ntitle: x\n---\n');
}

describe('BookFileStore locations (ADR 0018)', () => {
  it('finds standalone books, series bibles, and series books by slug', () => {
    book('projects', 'harbor');
    book('series', 'ember-cycle', 'series-bible');
    book('series', 'ember-cycle', 'the-first-flame');
    book('series', 'ember-cycle', 'the-last-ember');
    // Not books: no story.md, or not a slug.
    mkdirSync(join(dataDir, 'projects', 'empty'), { recursive: true });
    book('projects', 'Not A Slug');

    const store = new BookFileStore(dataDir);
    expect(store.listLocations()).toEqual([
      { slug: 'harbor', root: join(dataDir, 'projects/harbor'), seriesId: null, kind: 'book' },
      {
        slug: 'ember-cycle',
        root: join(dataDir, 'series/ember-cycle/series-bible'),
        seriesId: 'ember-cycle',
        kind: 'series-bible',
      },
      {
        slug: 'the-first-flame',
        root: join(dataDir, 'series/ember-cycle/the-first-flame'),
        seriesId: 'ember-cycle',
        kind: 'book',
      },
      {
        slug: 'the-last-ember',
        root: join(dataDir, 'series/ember-cycle/the-last-ember'),
        seriesId: 'ember-cycle',
        kind: 'book',
      },
    ]);
    expect(store.root('the-last-ember')).toBe(join(dataDir, 'series/ember-cycle/the-last-ember'));
    expect(() => store.root('empty')).toThrow(/was not found/u);
    expect(() => store.root('../projects/harbor')).toThrow();
  });

  it('keeps the first folder for a slug and reports the others', () => {
    book('projects', 'harbor');
    book('series', 'tides', 'series-bible');
    book('series', 'tides', 'harbor');

    const store = new BookFileStore(dataDir);
    expect(store.root('harbor')).toBe(join(dataDir, 'projects/harbor'));
    expect(store.listDuplicates().map((location) => location.root)).toEqual([
      join(dataDir, 'series/tides/harbor'),
    ]);
  });

  it('follows a book that moved into a series outside the store', () => {
    book('projects', 'harbor');
    const store = new BookFileStore(dataDir);
    expect(store.root('harbor')).toBe(join(dataDir, 'projects/harbor'));

    mkdirSync(join(dataDir, 'series', 'tides'), { recursive: true });
    renameSync(join(dataDir, 'projects/harbor'), join(dataDir, 'series/tides/harbor'));
    expect(store.locate('harbor')).toMatchObject({
      root: join(dataDir, 'series/tides/harbor'),
      seriesId: 'tides',
    });
  });

  it('treats a slug as taken by any book, series, or folder of that name', () => {
    book('projects', 'harbor');
    book('series', 'tides', 'series-bible');
    book('series', 'tides', 'low-water');
    mkdirSync(join(dataDir, 'projects', 'half-made'), { recursive: true });

    const store = new BookFileStore(dataDir);
    for (const slug of ['harbor', 'tides', 'low-water', 'half-made']) {
      expect(store.exists(slug)).toBe(true);
    }
    // Reserved: a series keeps its bible in a folder of this name.
    expect(store.exists('series-bible')).toBe(true);
    expect(store.exists('open-sea')).toBe(false);
  });
});
