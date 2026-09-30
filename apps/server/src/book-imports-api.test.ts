import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
