import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import matter from 'gray-matter';
import { afterEach, describe, expect, it } from 'vitest';

import { InvalidStoredDataError, UnsafePathError } from '../errors.js';
import { SourceFileStore } from './source-files.js';

const NOTEBOOK_ID = 'a0c7607c-b365-438b-a7e6-31b2308464b6';
const SOURCE_ID = 'f9942d0a-eaca-41a8-a3d8-87987cc173fd';
const CREATED_AT = '2026-07-10T12:00:00.000Z';
const tempDirs: string[] = [];

function makeStore(): { dataDir: string; store: SourceFileStore } {
  const dataDir = mkdtempSync(join(tmpdir(), 'worldbookllm-files-'));
  tempDirs.push(dataDir);
  return { dataDir, store: new SourceFileStore(dataDir) };
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('SourceFileStore', () => {
  it('writes readable, private, self-describing Markdown atomically', () => {
    const { dataDir, store } = makeStore();
    const content = '# Court\n\nAmber rules here.';

    const stored = store.write({
      id: SOURCE_ID,
      notebookId: NOTEBOOK_ID,
      title: 'The Amber Court',
      content,
      origin: { type: 'paste' },
      conversionNotes: [],
      createdAt: CREATED_AT,
    });

    expect(stored).toEqual({
      filePath: `notebooks/${NOTEBOOK_ID}/sources/${SOURCE_ID}-the-amber-court.md`,
      slug: 'the-amber-court',
      wordCount: 5,
      contentHash: createHash('sha256').update(content).digest('hex'),
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    });

    const absolutePath = join(dataDir, stored.filePath);
    const parsed = matter(readFileSync(absolutePath, 'utf8'));
    expect(parsed.data).toEqual({
      id: SOURCE_ID,
      notebookId: NOTEBOOK_ID,
      title: 'The Amber Court',
      origin: { type: 'paste' },
      conversionNotes: [],
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    });
    expect(parsed.content).toBe(content);
    expect(statSync(absolutePath).mode & 0o777).toBe(0o600);
    expect(readdirSync(join(dataDir, 'notebooks', NOTEBOOK_ID, 'sources'))).toEqual([
      `${SOURCE_ID}-the-amber-court.md`,
    ]);
  });

  it('reads fresh content and derived metadata after an external edit', () => {
    const { dataDir, store } = makeStore();
    const stored = store.write({
      id: SOURCE_ID,
      notebookId: NOTEBOOK_ID,
      title: 'Old title',
      content: 'old body',
      origin: { type: 'paste' },
      conversionNotes: [],
      createdAt: CREATED_AT,
    });
    const absolutePath = join(dataDir, stored.filePath);
    const editedAt = '2026-07-10T13:00:00.000Z';
    const editedContent = 'new body with five words';
    const current = matter(readFileSync(absolutePath, 'utf8'));
    current.data.title = 'Externally renamed';
    current.data.updatedAt = editedAt;
    const externalEdit = matter.stringify(editedContent, current.data);
    writeFileSync(absolutePath, externalEdit.replace(/\n$/u, ''), { mode: 0o600 });

    expect(store.read(stored.filePath)).toEqual({
      id: SOURCE_ID,
      notebookId: NOTEBOOK_ID,
      title: 'Externally renamed',
      origin: { type: 'paste' },
      conversionNotes: [],
      createdAt: CREATED_AT,
      updatedAt: editedAt,
      content: editedContent,
      wordCount: 5,
      contentHash: createHash('sha256').update(editedContent).digest('hex'),
    });
  });

  it('uses a readable fallback slug and rejects paths outside the data directory', () => {
    const { store } = makeStore();
    const stored = store.write({
      id: SOURCE_ID,
      notebookId: NOTEBOOK_ID,
      title: '日本語',
      content: 'body',
      origin: { type: 'paste' },
      conversionNotes: [],
      createdAt: CREATED_AT,
    });

    expect(stored.slug).toBe('source');
    expect(() => store.read('../secrets.json')).toThrow(UnsafePathError);
    expect(() => store.remove('/tmp/elsewhere.md')).toThrow(UnsafePathError);
  });

  it('rejects malformed frontmatter instead of guessing stored metadata', () => {
    const { dataDir, store } = makeStore();
    const relativePath = `notebooks/${NOTEBOOK_ID}/sources/broken.md`;
    const absolutePath = join(dataDir, relativePath);
    store.write({
      id: SOURCE_ID,
      notebookId: NOTEBOOK_ID,
      title: 'Valid first',
      content: 'body',
      origin: { type: 'paste' },
      conversionNotes: [],
      createdAt: CREATED_AT,
    });
    const realPath = join(dataDir, `notebooks/${NOTEBOOK_ID}/sources/${SOURCE_ID}-valid-first.md`);
    writeFileSync(absolutePath, '---\ntitle: Missing IDs\n---\nbody', { mode: 0o600 });
    chmodSync(realPath, 0o600);

    expect(() => store.read(relativePath)).toThrow(InvalidStoredDataError);
  });

  it('removes files and notebook directories idempotently', () => {
    const { dataDir, store } = makeStore();
    const stored = store.write({
      id: SOURCE_ID,
      notebookId: NOTEBOOK_ID,
      title: 'Lore',
      content: 'body',
      origin: { type: 'paste' },
      conversionNotes: [],
      createdAt: CREATED_AT,
    });

    expect(() => store.remove(stored.filePath)).not.toThrow();
    expect(() => store.remove(stored.filePath)).not.toThrow();
    store.write({
      id: SOURCE_ID,
      notebookId: NOTEBOOK_ID,
      title: 'Lore',
      content: 'body',
      origin: { type: 'paste' },
      conversionNotes: [],
      createdAt: CREATED_AT,
    });
    expect(() => store.removeNotebook(NOTEBOOK_ID)).not.toThrow();
    expect(() => store.removeNotebook(NOTEBOOK_ID)).not.toThrow();
    expect(() => statSync(join(dataDir, 'notebooks', NOTEBOOK_ID))).toThrow();
  });
});
