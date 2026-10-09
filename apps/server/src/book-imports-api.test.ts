import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import type {
  BookImportPreview,
  BookImportResult,
  BookSummary,
  Checkpoint,
  ManuscriptImportResult,
  NewBookImportPreview,
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

describe('new book import: preview, review, create (ADR 0026)', () => {
  async function previewNew(fileName: string, body: string | Buffer, query = '') {
    return app.inject({
      method: 'POST',
      url: `/api/books/import/preview${query}`,
      ...multipartUpload(fileName, body),
    });
  }

  /** Creates the book from a preview as reviewed: every entry kept, with its suggested kind. */
  async function createFrom(preview: NewBookImportPreview, extra: Record<string, unknown> = {}) {
    if (preview.kind !== 'documents') throw new Error('not a documents preview');
    return app.inject({
      method: 'POST',
      url: '/api/books/import/create',
      payload: {
        title: preview.title,
        import: {
          origin: preview.origin,
          entries: preview.entries.map((entry) => ({
            title: entry.title,
            markdown: entry.markdown,
            kind: entry.suggestedKind,
            origin: entry.origin,
            conversionNotes: entry.conversionNotes,
            numbered: entry.numbered,
            author: entry.author,
          })),
        },
        candidates: preview.candidates,
        skipped: preview.skipped,
        ...extra,
      },
    });
  }

  it('previews a manuscript as chapters without writing anything, then creates the book', async () => {
    const manuscript =
      '# Prologue\n\nThe storm came.\n\n# Chapter 1: Arrival\n\nMara Quill stepped off the ferry. Mara Quill waved. Mara Quill ran.\n\n# Chapter 2: The Bell\n\nThe bell rang twice.\n';
    const tempBefore = readdirSync(tmpdir()).filter((name) =>
      name.startsWith('worldbookllm-split-'),
    );
    const response = await previewNew('The Ferry.md', manuscript);
    expect(response.statusCode).toBe(200);
    const preview = response.json<NewBookImportPreview>();
    if (preview.kind !== 'documents') throw new Error('expected documents');
    expect(preview.title).toBe('The Ferry');
    expect(
      preview.entries.map(({ title, suggestedKind, numbered }) => ({
        title,
        suggestedKind,
        numbered,
      })),
    ).toEqual([
      { title: 'Prologue', suggestedKind: 'chapter', numbered: false },
      { title: 'Arrival', suggestedKind: 'chapter', numbered: undefined },
      { title: 'The Bell', suggestedKind: 'chapter', numbered: undefined },
    ]);
    expect(preview.candidates).toContainEqual({ name: 'Mara Quill', count: 3 });
    expect(readdirSync(join(dataDir, 'projects'))).toEqual([slug]);

    const created = await createFrom(preview, {
      form: 'novel',
      genre: 'mystery',
      language: 'en',
      targetWords: 60000,
    });
    expect(created.statusCode).toBe(201);
    const result = created.json<ManuscriptImportResult>();
    expect(result.book).toMatchObject({
      slug: 'the-ferry',
      title: 'The Ferry',
      genre: 'mystery',
      counts: { chapter: 3 },
    });
    expect(result.output).toContain('Created The Ferry with 3 chapters');
    expect(result.output).toContain('research/import-report.md');

    const root = join(dataDir, 'projects/the-ferry');
    const prologue = readFileSync(join(root, 'chapters/chapter-01.md'), 'utf8');
    expect(prologue).toMatch(/^numbered: false$/mu);
    expect(prologue).toContain('# Prologue\n\n## Chapter Text\n\nThe storm came.');
    expect(readFileSync(join(root, 'chapters/chapter-02.md'), 'utf8')).toContain(
      '# Chapter 2: Arrival',
    );
    const story = readFileSync(join(root, 'story.md'), 'utf8');
    expect(story).toMatch(/^form: novel$/mu);
    expect(story).toMatch(/^target-words: 60000$/mu);
    expect(story).toMatch(/^language: en$/mu);
    expect(story).not.toContain('worldbookllm-');
    expect(readFileSync(join(root, 'research/import-report.md'), 'utf8')).toContain(
      '- Mara Quill (3 mentions)',
    );
    const tempAfter = readdirSync(tmpdir()).filter((name) =>
      name.startsWith('worldbookllm-split-'),
    );
    expect(tempAfter).toEqual(tempBefore);
  });

  it("previews HTML and PDF manuscripts too, and splits on another language's headings", async () => {
    const html = await previewNew(
      'Bells.html',
      '<html><body><h1>Chapter 1</h1><p>One.</p><h1>Chapter 2</h1><p>Two.</p></body></html>',
    );
    expect(html.statusCode).toBe(200);
    expect(html.json<NewBookImportPreview>()).toMatchObject({
      kind: 'documents',
      entries: [{ markdown: 'One.' }, { markdown: 'Two.' }],
    });

    const french = await previewNew(
      'Cloches.md',
      '# Chapitre 1\n\nUn.\n\n# Chapitre 2\n\nDeux.\n',
      '?language=fr',
    );
    expect(french.json<NewBookImportPreview>()).toMatchObject({
      entries: [{ markdown: 'Un.' }, { markdown: 'Deux.' }],
    });
  });

  it('previews a zip of chapters and notes, keeping same-named files apart', async () => {
    const response = await previewNew(
      'The Lost Coast.zip',
      makeZip([
        { name: 'draft/a/b/ch.md', data: 'First part.\n' },
        { name: 'draft/a-b/ch.md', data: 'Second part.\n' },
        { name: 'draft/notes/tides.md', data: '# Tide tables\n\nSpring tides run high.\n' },
        { name: 'draft/cover.png', data: 'png' },
      ]),
    );
    const preview = response.json<NewBookImportPreview>();
    if (preview.kind !== 'documents') throw new Error('expected documents');
    expect(preview.entries.map((entry) => [entry.suggestedKind, entry.markdown])).toEqual([
      ['chapter', 'Second part.'],
      ['chapter', 'First part.'],
      ['research', '# Tide tables\n\nSpring tides run high.\n'],
    ]);
    expect(preview.entries[2]?.origin).toMatchObject({
      fileName: 'The Lost Coast.zip: draft/notes/tides.md',
    });
    expect(preview.skipped).toEqual(['draft/cover.png (not a supported document type)']);

    const created = await createFrom(preview);
    expect(created.statusCode).toBe(201);
    const root = join(dataDir, 'projects/the-lost-coast');
    expect(readFileSync(join(root, 'research/tide-tables.md'), 'utf8')).toContain(
      'origin-file: "The Lost Coast.zip: draft/notes/tides.md"',
    );
    expect(readFileSync(join(root, 'research/import-report.md'), 'utf8')).toContain(
      'draft/cover.png',
    );
  });

  it('reports a whole project zip for direct import, and only takes zips directly', async () => {
    const project = await previewNew(
      'Whole.zip',
      makeZip([{ name: 'story.md', data: '---\ntitle: Whole Book\n---\n' }]),
    );
    expect(project.json<NewBookImportPreview>()).toEqual({
      kind: 'project',
      title: 'Whole Book',
      files: 1,
      skipped: [],
    });
    const direct = await app.inject({
      method: 'POST',
      url: '/api/books/import',
      ...multipartUpload('book.md', '# Hi'),
    });
    expect(direct.statusCode).toBe(400);
  });

  it('sends a book whose import fails validation to the trash', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/books/import/create',
      payload: {
        title: 'Broken Import',
        import: {
          origin: { type: 'paste' },
          entries: [
            {
              title: 'Bram',
              markdown: characterFile.replace('status: alive', 'status: sleepy'),
              kind: 'character',
            },
          ],
        },
      },
    });
    expect(created.statusCode).toBe(400);
    expect(readdirSync(join(dataDir, 'projects'))).toEqual([slug]);
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

  it('splits a file with several chapter headings into one entry per chapter', async () => {
    const response = await preview(
      'act-two.md',
      '# Chapter 4: Fog\n\nGrey.\n\n# Chapter 5: Rain\n\nWet.\n',
    );
    expect(
      response
        .json<BookImportPreview>()
        .entries.map(({ title, markdown, suggestedKind }) => [title, markdown, suggestedKind]),
    ).toEqual([
      ['Fog', 'Grey.', 'chapter'],
      ['Rain', 'Wet.', 'chapter'],
    ]);
  });

  it("inserts chapters before a reviewed chapter and replaces a chapter's prose in place", async () => {
    await importEntries([
      { title: 'One', markdown: 'First.', kind: 'chapter' },
      { title: 'Two', markdown: 'Second.', kind: 'chapter' },
      { title: 'Three', markdown: 'Third.', kind: 'chapter' },
    ]);
    // Give chapter 2 frontmatter that a replace must keep.
    const two = bookFile('chapters/chapter-02.md').replace('pov: ""', 'pov: "mara"');
    writeFileSync(join(dataDir, 'projects', slug, 'chapters/chapter-02.md'), two);

    const response = await importEntries([
      {
        title: 'Interlude A',
        markdown: 'A.',
        kind: 'chapter',
        placement: { at: 'before', chapter: 2 },
      },
      {
        title: 'Interlude B',
        markdown: 'B.',
        kind: 'chapter',
        placement: { at: 'before', chapter: 2 },
      },
      {
        title: 'Two',
        markdown: 'Second, revised.',
        kind: 'chapter',
        placement: { at: 'replace', chapter: 2 },
      },
      {
        title: 'Four',
        markdown: 'Fourth.',
        kind: 'chapter',
        placement: { at: 'before', chapter: 3 },
      },
    ]);
    expect(response.statusCode).toBe(201);
    const prose = (n: number) =>
      /## Chapter Text\n\n([\s\S]*)$/u.exec(bookFile(`chapters/chapter-0${n}.md`))?.[1]?.trim();
    expect([1, 2, 3, 4, 5, 6].map(prose)).toEqual([
      'First.',
      'A.',
      'B.',
      'Second, revised.',
      'Fourth.',
      'Third.',
    ]);
    expect(bookFile('chapters/chapter-04.md')).toMatch(/^pov: "mara"$/mu);
    expect(bookFile('chapters/chapter-04.md')).toMatch(/^title: Two$/mu);
    expect((await validate()).ok).toBe(true);

    const missing = await importEntries([
      { title: 'X', markdown: 'X.', kind: 'chapter', placement: { at: 'replace', chapter: 40 } },
    ]);
    expect(missing.statusCode).toBe(400);
    expect(existsSync(join(dataDir, 'projects', slug, 'chapters/chapter-07.md'))).toBe(false);
  }, 30_000);

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
