import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import type {
  BookImportPreview,
  BookImportResult,
  BookSummary,
  Checkpoint,
  ManuscriptImportResult,
} from '@worldbookllm/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import { makeZip, type TestZipEntry } from './story/test-zip.js';

let app: FastifyInstance;
let dataDir: string;
let slug: string;

function multipartUpload(fileName: string, body: string | Buffer) {
  const boundary = 'worldbookllm-boundary';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([head, Buffer.from(body), tail]),
  };
}

function bookFile(path: string): string {
  return readFileSync(join(dataDir, 'projects', slug, path), 'utf8');
}

async function importEntries(entries: unknown[], origin: unknown = { type: 'paste' }) {
  return app.inject({
    method: 'POST',
    url: `/api/books/${slug}/imports`,
    payload: { origin, entries },
  });
}

async function validate() {
  const response = await app.inject({ method: 'GET', url: `/api/books/${slug}/checks/validate` });
  return response.json<{ envelope: { ok: boolean } }>().envelope;
}

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'worldbookllm-book-imports-'));
  app = buildApp({ dataDir, logger: false });
  const created = await app.inject({
    method: 'POST',
    url: '/api/books',
    payload: { title: 'Harbor' },
  });
  slug = created.json<BookSummary>().slug;
});

afterEach(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const characterFile = `---
name: Sera Voss
role: protagonist
status: alive
aliases:
  - The Ember
---

# Sera Voss

## Appearance

Ash on her sleeves.
`;

describe('book import previews', () => {
  it('suggests the entity kind of a story-skills entity file', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/books/${slug}/previews/file`,
      ...multipartUpload('sera-voss.md', characterFile),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<BookImportPreview>()).toMatchObject({
      format: 'markdown',
      origin: { type: 'file', fileName: 'sera-voss.md' },
      entries: [{ suggestedKind: 'character', entityFile: true }],
    });
  });

  it('suggests research for plain Markdown and text', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/books/${slug}/previews/file`,
      ...multipartUpload('tides.md', '# Tides\n\nThe harbor floods at the spring tide.\n'),
    });
    expect(response.json<BookImportPreview>().entries).toEqual([
      expect.objectContaining({ title: 'Tides', suggestedKind: 'research', entityFile: false }),
    ]);
  });

  it('suggests character for a SillyTavern character card', async () => {
    const card = JSON.stringify({
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: { name: 'Ilya Venn', description: 'A lighthouse keeper.', personality: 'Patient.' },
    });
    const response = await app.inject({
      method: 'POST',
      url: `/api/books/${slug}/previews/file`,
      ...multipartUpload('ilya.json', card),
    });
    expect(response.json<BookImportPreview>()).toMatchObject({
      format: 'character',
      entries: [{ suggestedKind: 'character', entityFile: false }],
    });
  });
});

describe('book imports', () => {
  it('files plain content as a research note with flat provenance, in one checkpoint', async () => {
    const response = await importEntries(
      [
        {
          title: 'Tides',
          markdown: '# Tides\n\nThe harbor floods at the spring tide.\n',
          kind: 'research',
        },
      ],
      { type: 'file', fileName: 'tides.md', mediaType: 'text/markdown' },
    );
    expect(response.statusCode).toBe(201);
    const result = response.json<BookImportResult>();
    expect(result.files).toEqual(['research/tides.md']);
    expect(result.validation).toMatchObject({ ok: true });

    const note = bookFile('research/tides.md');
    expect(note).toMatch(/^---\ntitle: "Tides"\nstatus: open\nsources: \[\]\nused-in: \[\]\n/u);
    expect(note).toContain('origin-type: "file"\norigin-file: "tides.md"');
    expect(note).toMatch(/imported-at: "\d{4}-\d{2}-\d{2}T/u);
    expect(note).toContain('## Findings\n\nThe harbor floods at the spring tide.');
    expect(note).not.toContain('# Tides\n\n# Tides');
    expect(bookFile('research/_index.md')).toContain('Tides');

    const checkpoints = (
      await app.inject({ method: 'GET', url: `/api/books/${slug}/checkpoints` })
    ).json<Checkpoint[]>();
    expect(checkpoints[0]).toMatchObject({ id: result.checkpointId, label: 'Import Tides' });
  });

  it('keeps an entity file as imported and names it from its own frontmatter', async () => {
    const response = await importEntries([
      { title: 'Whatever the heading said', markdown: characterFile, kind: 'character' },
    ]);
    expect(response.statusCode).toBe(201);
    expect(response.json<BookImportResult>().files).toEqual(['characters/sera-voss.md']);
    const character = bookFile('characters/sera-voss.md');
    expect(character).toContain(
      'role: protagonist\nstatus: alive\naliases:\n  - The Ember\norigin-type: "paste"',
    );
    expect(character).toContain('## Appearance\n\nAsh on her sleeves.');
    expect(await validate()).toMatchObject({ ok: true });
  });

  it('creates other kinds with story add and gives them the imported text', async () => {
    const response = await importEntries([
      {
        title: 'Port Kestrel',
        markdown: '# Port Kestrel\n\nA harbor town of bells.\n',
        kind: 'location',
      },
    ]);
    expect(response.statusCode).toBe(201);
    const location = bookFile('worldbuilding/locations/port-kestrel.md');
    expect(location).toMatch(/^---\nname: Port Kestrel\n/u);
    expect(location).toContain('origin-type: "paste"');
    expect(location).toContain('# Port Kestrel\n\nA harbor town of bells.\n');
    expect(await validate()).toMatchObject({ ok: true });
  });

  it('keeps unusable frontmatter visibly in the body instead of dropping it', async () => {
    const markdown = '---\nstatus: draft\nmeta:\n  nested: true\n---\n# Old Notes\n\nKeep me.\n';
    const response = await importEntries([{ title: 'Old Notes', markdown, kind: 'research' }]);
    expect(response.statusCode).toBe(201);
    const note = bookFile('research/old-notes.md');
    expect(note).toContain(
      'Keep me.\n\n## Original frontmatter\n\n```yaml\nstatus: draft\nmeta:\n  nested: true\n```',
    );
    expect(note).toMatch(/^---\ntitle: "Old Notes"\nstatus: open\n/u);
    expect(await validate()).toMatchObject({ ok: true });
  });

  it('gives colliding titles distinct ids, including against existing files', async () => {
    await importEntries([{ title: 'Tides', markdown: 'First.', kind: 'research' }]);
    const response = await importEntries([
      { title: 'Tides', markdown: 'Second.', kind: 'research' },
      { title: 'Tides', markdown: 'Third.', kind: 'research' },
      { title: 'Пётр', markdown: 'No ASCII.', kind: 'research' },
    ]);
    expect(response.json<BookImportResult>().files).toEqual([
      'research/tides-2.md',
      'research/tides-3.md',
      'research/research.md',
    ]);
    expect(await validate()).toMatchObject({ ok: true });
  });

  it('undoes the whole import when story validate rejects an imported file', async () => {
    const invalid = characterFile.replace('status: alive', 'status: sleepy');
    const response = await importEntries([
      { title: 'Tides', markdown: 'Fine.', kind: 'research' },
      { title: 'Sera', markdown: invalid, kind: 'character' },
    ]);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_import' });
    expect(response.json<{ message: string }>().message).toMatch(/undone.*sleepy|undone.*status/su);
    expect(existsSync(join(dataDir, 'projects', slug, 'research/tides.md'))).toBe(false);
    expect(existsSync(join(dataDir, 'projects', slug, 'characters/sera-voss.md'))).toBe(false);
    const checkpoints = (
      await app.inject({ method: 'GET', url: `/api/books/${slug}/checkpoints` })
    ).json<Checkpoint[]>();
    expect(checkpoints[0]?.undoneAt).not.toBeNull();
  });
});

describe('manuscript import', () => {
  it('creates a new book split into chapters and removes its temporary files', async () => {
    const manuscript =
      '# Chapter 1: Arrival\n\nMara stepped off the ferry.\n\n# Chapter 2: The Bell\n\nThe bell rang twice.\n';
    const before = readdirSync(tmpdir()).filter((name) => name.startsWith('worldbookllm-import-'));
    const response = await app.inject({
      method: 'POST',
      url: '/api/books/import',
      ...multipartUpload('The Ferry.md', manuscript),
    });
    expect(response.statusCode).toBe(201);
    const result = response.json<ManuscriptImportResult>();
    expect(result.book).toMatchObject({
      slug: 'the-ferry',
      title: 'The Ferry',
      counts: { chapter: 2 },
    });
    expect(result.output).toContain('Imported 2 chapters');
    expect(result.output).not.toContain(dataDir);
    expect(
      readFileSync(join(dataDir, 'projects/the-ferry/chapters/chapter-02.md'), 'utf8'),
    ).toContain('The bell rang twice.');
    const after = readdirSync(tmpdir()).filter((name) => name.startsWith('worldbookllm-import-'));
    expect(after).toEqual(before);
  });

  it('refuses files that are not Markdown or text', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/books/import',
      ...multipartUpload('book.pdf', '%PDF-1.4'),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid_import' });
  });
});

/** Zips a book folder from disk, every file under `prefix`. */
function zipBook(root: string, prefix = ''): TestZipEntry[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const path = relative(root, join(entry.parentPath, entry.name)).replaceAll('\\', '/');
      return { name: `${prefix}${path}`, data: readFileSync(join(root, path)) };
    });
}

describe('project zip import', () => {
  async function upload(fileName: string, bytes: Buffer) {
    return app.inject({
      method: 'POST',
      url: '/api/books/import',
      ...multipartUpload(fileName, bytes),
    });
  }

  it('imports a zipped book folder as a new book and validates it', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/books/${slug}/entities`,
      payload: { kind: 'character', name: 'Ilse Marrow', options: {} },
    });
    const entries = zipBook(join(dataDir, 'projects', slug), 'harbor/');
    entries.push({ name: 'harbor/dist/harbor.epub', data: 'old build' });
    entries.push({ name: 'harbor/.DS_Store', data: 'noise' });

    const response = await upload('Harbor backup.zip', makeZip(entries));
    expect(response.statusCode).toBe(201);
    const result = response.json<ManuscriptImportResult>();
    expect(result.book).toMatchObject({
      slug: 'harbor-2',
      title: 'Harbor',
      counts: { character: 1 },
    });
    expect(result.output).toContain('from Harbor backup.zip');
    expect(result.output).toContain('story validate found no problems.');
    expect(result.output).toContain('harbor/dist/harbor.epub (build output)');
    expect(result.output).not.toContain('.DS_Store');
    expect(result.output).not.toContain(dataDir);
    const imported = join(dataDir, 'projects/harbor-2');
    expect(readFileSync(join(imported, 'characters/ilse-marrow.md'), 'utf8')).toBe(
      readFileSync(join(dataDir, 'projects', slug, 'characters/ilse-marrow.md'), 'utf8'),
    );
    expect(existsSync(join(imported, 'dist'))).toBe(false);
    expect(readdirSync(join(dataDir, 'projects')).filter((name) => name.startsWith('.'))).toEqual(
      [],
    );
  });

  it('drops series links so the book arrives standalone', async () => {
    const story = join(dataDir, 'projects', slug, 'story.md');
    writeFileSync(
      story,
      readFileSync(story, 'utf8').replace(
        /^title: .*$/mu,
        (line) => `${line}\nseries: tides\nbook-number: 2\nfollows:\n  - ../first/story.md`,
      ),
    );
    const response = await upload('tides.zip', makeZip(zipBook(join(dataDir, 'projects', slug))));
    expect(response.statusCode).toBe(201);
    const result = response.json<ManuscriptImportResult>();
    expect(result.output).toContain('Removed its series links');
    expect(result.book).toMatchObject({ seriesId: null, bookNumber: null, follows: [] });
    const imported = readFileSync(join(dataDir, 'projects', result.book.slug, 'story.md'), 'utf8');
    expect(imported).not.toMatch(/^(series|follows|book-number):/mu);
  });

  it('rejects archives that are not a usable project and leaves nothing behind', async () => {
    const notProject = await upload('cover.zip', makeZip([{ name: 'cover.png', data: 'png' }]));
    expect(notProject.statusCode).toBe(400);
    expect(notProject.json()).toMatchObject({ error: 'invalid_import' });

    const evil = await upload(
      'evil.zip',
      makeZip([
        { name: 'story.md', data: '---\ntitle: Evil\n---\n' },
        { name: '../escape.md', data: 'x' },
      ]),
    );
    expect(evil.statusCode).toBe(400);
    expect(existsSync(join(dataDir, 'escape.md'))).toBe(false);
    expect(readdirSync(join(dataDir, 'projects'))).toEqual([slug]);
  });

  it('imports a project whose registries cannot be rebuilt, and says why', async () => {
    const response = await upload(
      'unparsable.zip',
      makeZip([
        { name: 'story.md', data: '---\ntitle: Unparsable\n---\n' },
        { name: 'characters/bram.md', data: '---\nname: Bram\nname: Bram again\n---\n' },
      ]),
    );
    expect(response.statusCode).toBe(201);
    const result = response.json<ManuscriptImportResult>();
    expect(result.output).toContain('story reindex could not regenerate the registries');
    expect(result.output).toMatch(/story validate found [1-9]\d* errors?/u);
  });

  it('imports a project with validation errors and says so', async () => {
    const response = await upload(
      'broken.zip',
      makeZip([{ name: 'story.md', data: '---\ntitle: Broken\n---\n' }]),
    );
    expect(response.statusCode).toBe(201);
    const result = response.json<ManuscriptImportResult>();
    expect(result.book.slug).toBe('broken');
    expect(result.output).toMatch(
      /story validate found \d+ errors? and \d+ warnings?; see the Health tab/u,
    );
  });

  it('builds a book from a zip of chapters and notes with no story.md', async () => {
    const response = await upload(
      'The Lost Coast.zip',
      makeZip([
        { name: 'draft/chapter-10.md', data: '# Chapter 10: Landfall\n\nThe boat struck sand.\n' },
        { name: 'draft/chapter-2.md', data: '# Chapter 2\n\nFog over the harbor.\n' },
        { name: 'draft/prologue.txt', data: 'Before the storm.\n' },
        { name: 'draft/notes/tides.md', data: '# Tide tables\n\nSpring tides run high.\n' },
        { name: 'draft/cover.png', data: 'png' },
      ]),
    );
    expect(response.statusCode).toBe(201);
    const result = response.json<ManuscriptImportResult>();
    expect(result.book).toMatchObject({ slug: 'the-lost-coast', title: 'The Lost Coast' });
    expect(result.output).toContain('Imported 3 chapters');
    expect(result.output).toContain('research/tide-tables.md');
    expect(result.output).toContain('draft/cover.png (not a supported document type)');
    expect(result.output).not.toContain(tmpdir());

    const root = join(dataDir, 'projects/the-lost-coast');
    const chapters = ['chapter-01.md', 'chapter-02.md', 'chapter-03.md'].map((name) =>
      readFileSync(join(root, 'chapters', name), 'utf8'),
    );
    expect(chapters[0]).toContain('Before the storm.');
    expect(chapters[1]).toContain('Fog over the harbor.');
    expect(chapters[2]).toContain('The boat struck sand.');
    const note = readFileSync(join(root, 'research/tide-tables.md'), 'utf8');
    expect(note).toContain('Spring tides run high.');
    expect(note).toContain('origin-file: "The Lost Coast.zip: draft/notes/tides.md"');
  });

  it('starts an empty book when a zip without story.md holds only notes', async () => {
    const response = await upload(
      'Lore.zip',
      makeZip([{ name: 'research/salt.md', data: '# Salt trade\n\nCaravans.\n' }]),
    );
    expect(response.statusCode).toBe(201);
    const result = response.json<ManuscriptImportResult>();
    expect(result.book.slug).toBe('lore');
    expect(readFileSync(join(dataDir, 'projects/lore/research/salt-trade.md'), 'utf8')).toContain(
      'Caravans.',
    );
  });
});

describe('adding files to an existing book', () => {
  async function preview(fileName: string, body: string | Buffer) {
    return app.inject({
      method: 'POST',
      url: `/api/books/${slug}/previews/file`,
      ...multipartUpload(fileName, body),
    });
  }

  it('suggests a chapter for a chapter file and appends it after the last chapter', async () => {
    const first = await preview('chapter-1.md', '# Chapter 1: Arrival\n\nThe ferry docked.\n');
    expect(first.json<BookImportPreview>().entries[0]).toMatchObject({
      title: 'Chapter 1: Arrival',
      suggestedKind: 'chapter',
      entityFile: false,
    });
    const notes = await preview('harbor-notes.md', '# Harbor notes\n\nDepths.\n');
    expect(notes.json<BookImportPreview>().entries[0]?.suggestedKind).toBe('research');

    const imported = await importEntries([
      {
        title: 'Chapter 1: Arrival',
        markdown: '# Chapter 1: Arrival\n\nThe ferry docked.\n',
        kind: 'chapter',
      },
      { title: 'The Lighthouse', markdown: 'The lamp was dark.\n', kind: 'chapter' },
    ]);
    expect(imported.statusCode).toBe(201);
    expect(imported.json<BookImportResult>().files).toEqual([
      'chapters/chapter-01.md',
      'chapters/chapter-02.md',
    ]);
    const chapter = bookFile('chapters/chapter-01.md');
    expect(chapter).toMatch(/^title: Arrival$/mu);
    expect(chapter).toMatch(/^status: draft$/mu);
    expect(chapter).toContain('# Chapter 1: Arrival\n\n## Chapter Text\n\nThe ferry docked.');
    expect(chapter).not.toContain('## Outline');
    expect(bookFile('chapters/chapter-02.md')).toMatch(/^word-count: 4$/mu);
    expect((await validate()).ok).toBe(true);

    await importEntries([{ title: 'Epilogue', markdown: 'Gulls.\n', kind: 'chapter' }]);
    expect(bookFile('chapters/chapter-03.md')).toContain('Gulls.');
  });

  it('previews a zip of files with an origin per file, and refuses a whole project', async () => {
    const response = await preview(
      'more.zip',
      makeZip([
        { name: 'chapters/ch-2.md', data: 'Second.\n' },
        { name: 'chapters/ch-10.md', data: 'Tenth.\n' },
        { name: 'research/ships.md', data: '# Ships\n\nSloops.\n' },
      ]),
    );
    expect(response.statusCode).toBe(200);
    const result = response.json<BookImportPreview>();
    expect(result.origin).toEqual({
      type: 'file',
      fileName: 'more.zip',
      mediaType: 'application/zip',
    });
    expect(result.entries.map((entry) => [entry.suggestedKind, entry.origin])).toEqual([
      [
        'chapter',
        { type: 'file', fileName: 'more.zip: chapters/ch-2.md', mediaType: 'text/markdown' },
      ],
      [
        'chapter',
        { type: 'file', fileName: 'more.zip: chapters/ch-10.md', mediaType: 'text/markdown' },
      ],
      [
        'research',
        { type: 'file', fileName: 'more.zip: research/ships.md', mediaType: 'text/markdown' },
      ],
    ]);

    const project = await preview(
      'book.zip',
      makeZip([{ name: 'story.md', data: '---\ntitle: X\n---\n' }]),
    );
    expect(project.statusCode).toBe(400);
    expect(project.json<{ message: string }>().message).toContain('whole story project');
  });

  it('keeps every chapter when files in different folders share a name', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/books/import',
      ...multipartUpload(
        'Parts.zip',
        makeZip([
          { name: 'a/b/ch.md', data: 'First part.\n' },
          { name: 'a-b/ch.md', data: 'Second part.\n' },
        ]),
      ),
    });
    expect(response.statusCode).toBe(201);
    const root = join(dataDir, 'projects/parts/chapters');
    expect(readFileSync(join(root, 'chapter-01.md'), 'utf8')).toContain('Second part.');
    expect(readFileSync(join(root, 'chapter-02.md'), 'utf8')).toContain('First part.');
  });

  it('previews HTML in a zip with its converter notes, and keeps each file named', async () => {
    const zipName = `${'z'.repeat(250)}.zip`;
    const response = await preview(
      zipName,
      makeZip([
        { name: 'web/page.html', data: '<html><body><h1>Docks</h1><p>Cranes.</p></body></html>' },
        { name: 'web/other.md', data: 'Other.\n' },
      ]),
    );
    expect(response.statusCode).toBe(200);
    const entries = response.json<BookImportPreview>().entries;
    expect(entries.map((entry) => entry.origin)).toEqual([
      {
        type: 'file',
        fileName: expect.stringMatching(/…: web\/other\.md$/u),
        mediaType: 'text/markdown',
      },
      {
        type: 'file',
        fileName: expect.stringMatching(/…: web\/page\.html$/u),
        mediaType: 'text/html',
      },
    ]);
    expect(entries[1]?.markdown).toContain('Cranes.');
    expect(
      entries.every((entry) => (entry.origin as { fileName: string }).fileName.length <= 255),
    ).toBe(true);

    const imported = await importEntries([
      {
        title: 'Docks',
        markdown: '# Docks\n\nCranes.\n',
        kind: 'research',
        origin: { type: 'file', fileName: 'docks.html', mediaType: 'text/html' },
        conversionNotes: ['Removed 2 scripts.'],
      },
    ]);
    expect(imported.statusCode).toBe(201);
    const note = bookFile(imported.json<BookImportResult>().files[0]!);
    expect(note).toContain('origin-file: "docks.html"');
    expect(note).toContain('  - "Removed 2 scripts."');
  });

  it('refuses chapters in a series bible', async () => {
    const series = await app.inject({
      method: 'POST',
      url: '/api/series',
      payload: { title: 'Tides' },
    });
    const bible = series.json<BookSummary>().slug;
    const response = await app.inject({
      method: 'POST',
      url: `/api/books/${bible}/imports`,
      payload: {
        origin: { type: 'paste' },
        entries: [{ title: 'One', markdown: 'Text.', kind: 'chapter' }],
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ message: string }>().message).toContain('series bible');
  });
});
