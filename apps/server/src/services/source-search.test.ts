import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../db/database.js';
import { SourceFileStore } from '../files/source-files.js';
import { NotebookService } from './notebooks.js';
import { toFtsMatchQuery } from './source-search.js';
import { SourceService } from './sources.js';

const tempDirs: string[] = [];

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), 'worldbookllm-search-'));
  tempDirs.push(dataDir);
  const db = openDatabase(dataDir);
  const files = new SourceFileStore(dataDir);
  const notebooks = new NotebookService(db, files);
  const sources = new SourceService(db, files);
  const notebook = notebooks.create({ name: 'Atlas', settings: null });
  return { dataDir, db, files, notebooks, sources, notebook };
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

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

describe('SourceService.search', () => {
  it('finds sources by content with an excerpt, ranking title matches first', () => {
    const { db, sources, notebook } = setup();
    const inTitle = sources.create(notebook.id, {
      title: 'Iron Compact charter',
      content: 'The founding charter of the cartel.',
    });
    const inBody = sources.create(notebook.id, {
      title: 'Harbor gossip',
      content: 'Dockworkers whisper that the Iron Compact controls the eastern quays.',
    });
    sources.create(notebook.id, { title: 'Weather', content: 'It rains in the marsh.' });

    const results = sources.search(notebook.id, 'iron compact');
    expect(results.map((result) => result.id)).toEqual([inTitle.id, inBody.id]);
    expect(results[1]?.excerpt).toContain('Iron Compact');
    expect(results[0]).toMatchObject({ title: 'Iron Compact charter', category: null, tags: [] });
    db.close();
  });

  it('matches prefixes and diacritic variants', () => {
    const { db, sources, notebook } = setup();
    const created = sources.create(notebook.id, {
      title: 'Cité of Mirrors',
      content: 'A crystalline metropolis.',
    });
    expect(sources.search(notebook.id, 'cite').map((result) => result.id)).toEqual([created.id]);
    expect(sources.search(notebook.id, 'crystal').map((result) => result.id)).toEqual([created.id]);
    db.close();
  });

  it.each(['"', 'NEAR(', '-iron', '"unbalanced', '(paren OR', '*', '\0', 'iron\0compact'])(
    'treats hostile query %j as literal text instead of erroring',
    (query) => {
      const { db, sources, notebook } = setup();
      sources.create(notebook.id, { title: 'Lore', content: 'Plain body text.' });
      expect(() => sources.search(notebook.id, query)).not.toThrow();
      db.close();
    },
  );

  it('caps excerpts at the response schema limit even for giant unbroken tokens', () => {
    const { db, sources, notebook } = setup();
    sources.create(notebook.id, {
      title: 'Blob',
      content: `start ${'x'.repeat(5000)} end`,
    });
    const results = sources.search(notebook.id, 'xxx');
    expect(results).toHaveLength(1);
    expect(results[0]!.excerpt.length).toBeLessThanOrEqual(1000);
    db.close();
  });

  it('reflects patches, scopes by notebook, and forgets deleted sources', () => {
    const { db, sources, notebooks, notebook } = setup();
    const other = notebooks.create({ name: 'Other', settings: null });
    const mine = sources.create(notebook.id, { title: 'Marsh', content: 'Old wetland notes.' });
    const theirs = sources.create(other.id, { title: 'Marsh', content: 'Different notebook.' });

    expect(sources.search(notebook.id, 'wetland').map((result) => result.id)).toEqual([mine.id]);
    expect(sources.search(other.id, 'wetland')).toEqual([]);

    sources.patch(mine.id, { content: 'Rewritten as saltflats now.' });
    expect(sources.search(notebook.id, 'wetland')).toEqual([]);
    expect(sources.search(notebook.id, 'saltflats').map((result) => result.id)).toEqual([mine.id]);

    sources.delete(mine.id);
    expect(sources.search(notebook.id, 'saltflats')).toEqual([]);

    notebooks.delete(other.id);
    const orphaned = db
      .prepare('SELECT count(*) FROM source_search WHERE notebook_id = ?')
      .pluck()
      .get(other.id);
    expect(orphaned).toBe(0);
    expect(theirs.id).toBeTruthy();
    db.close();
  });

  it('reindexes a source when an out-of-band file edit is reconciled on read', () => {
    const { db, files, sources, notebook } = setup();
    const created = sources.create(notebook.id, { title: 'Court', content: 'Amber halls.' });
    files.write({
      id: created.id,
      notebookId: notebook.id,
      title: created.title,
      content: 'Obsidian halls now.',
      origin: { type: 'paste' },
      conversionNotes: [],
      category: null,
      tags: [],
      createdAt: created.createdAt,
      updatedAt: '2026-07-17T09:00:00.000Z',
    });

    sources.get(created.id);
    expect(sources.search(notebook.id, 'obsidian').map((result) => result.id)).toEqual([
      created.id,
    ]);
    expect(sources.search(notebook.id, 'amber')).toEqual([]);
    db.close();
  });
});

describe('SourceService.ensureSearchIndex', () => {
  it('refreshes entries for files edited while the app was closed', () => {
    const { db, files, sources, notebook } = setup();
    const created = sources.create(notebook.id, { title: 'Court', content: 'Amber halls.' });
    // Edit the file out-of-band with no read in between — as if the app was
    // closed — then simulate the startup reconciliation.
    files.write({
      id: created.id,
      notebookId: notebook.id,
      title: created.title,
      content: 'Basalt halls now.',
      origin: { type: 'paste' },
      conversionNotes: [],
      category: null,
      tags: [],
      createdAt: created.createdAt,
      updatedAt: '2026-07-17T09:00:00.000Z',
    });

    sources.ensureSearchIndex();
    expect(sources.search(notebook.id, 'basalt').map((result) => result.id)).toEqual([created.id]);
    expect(sources.search(notebook.id, 'amber')).toEqual([]);
    // The metadata row was reconciled too, not just the FTS entry.
    expect(sources.list(notebook.id)[0]?.updatedAt).toBe('2026-07-17T09:00:00.000Z');
    db.close();
  });

  it('backfills missing entries and drops entries whose files became unreadable', () => {
    const { db, files, sources, notebook } = setup();
    const kept = sources.create(notebook.id, { title: 'Kept', content: 'Indexed normally.' });
    const stale = sources.create(notebook.id, { title: 'Stale', content: 'Missing from index.' });
    const broken = sources.create(notebook.id, { title: 'Broken', content: 'File vanishes.' });
    // Still indexed, but its file disappeared while the app was closed.
    const ghost = sources.create(notebook.id, { title: 'Ghost', content: 'Haunting text.' });

    // Simulate a pre-M3 database: rows exist but the index entries do not.
    db.prepare('DELETE FROM source_search WHERE source_id IN (?, ?)').run(stale.id, broken.id);
    files.remove(broken.filePath);
    files.remove(ghost.filePath);
    expect(sources.search(notebook.id, 'missing')).toEqual([]);

    const failures: string[] = [];
    sources.ensureSearchIndex((sourceId) => failures.push(sourceId));

    expect(sources.search(notebook.id, 'missing').map((result) => result.id)).toEqual([stale.id]);
    expect(sources.search(notebook.id, 'indexed').map((result) => result.id)).toEqual([kept.id]);
    // The ghost's old content no longer serves search hits.
    expect(sources.search(notebook.id, 'haunting')).toEqual([]);
    expect(failures.sort()).toEqual([broken.id, ghost.id].sort());
    db.close();
  });
});
