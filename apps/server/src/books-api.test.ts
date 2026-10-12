import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  BookBuildFile,
  BookBuildResult,
  BookCheckResult,
  BookFileDetail,
  BookPlay,
  BookSearchResult,
  BookSummary,
  BookTree,
  ChapterEndingDetail,
  Checkpoint,
  CheckpointDetail,
  InteractiveStory,
  StoryCommandOutcome,
} from '@worldbookllm/shared';
import {
  bookPlaySchema,
  chapterEndingDetailSchema,
  inkConversionPreviewSchema,
  interactiveStorySchema,
} from '@worldbookllm/shared';
import type { FastifyInstance } from 'fastify';
import { Story } from 'inkjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from './app.js';
import { StoryCli } from './story/story-cli.js';

let app: FastifyInstance;
let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'worldbookllm-books-api-'));
  app = buildApp({ dataDir, logger: false });
});

afterEach(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

async function createBook(title = 'The Salt Road'): Promise<BookSummary> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/books',
    payload: { title, genre: 'fantasy', tense: 'present' },
  });
  expect(response.statusCode).toBe(201);
  return response.json<BookSummary>();
}

async function readFile(book: string, path: string): Promise<BookFileDetail> {
  const response = await app.inject({ method: 'GET', url: `/api/books/${book}/files/${path}` });
  expect(response.statusCode).toBe(200);
  return response.json<BookFileDetail>();
}

async function addEntity(book: string, kind: string, name: string, options = {}) {
  const response = await app.inject({
    method: 'POST',
    url: `/api/books/${book}/entities`,
    payload: { kind, name, options },
  });
  return response;
}

describe('books API', () => {
  it('creates a book with story init and lists it', async () => {
    const book = await createBook();
    expect(book).toMatchObject({
      slug: 'the-salt-road',
      title: 'The Salt Road',
      genre: 'fantasy',
      status: 'planning',
      kind: 'book',
      seriesId: null,
      counts: {},
    });
    expect(existsSync(join(dataDir, 'projects/the-salt-road/story.md'))).toBe(true);
    const story = readFileSync(join(dataDir, 'projects/the-salt-road/story.md'), 'utf8');
    expect(story).toContain('tense: present');

    const second = await createBook();
    expect(second.slug).toBe('the-salt-road-2');

    const list = await app.inject({ method: 'GET', url: '/api/books' });
    expect(list.json<BookSummary[]>().map((entry) => entry.slug)).toEqual([
      'the-salt-road',
      'the-salt-road-2',
    ]);
  });

  it('names the folder "book" when a title has no ASCII letters', async () => {
    const book = await createBook('Война и мир');
    expect(book).toMatchObject({ slug: 'book', title: 'Война и мир' });
  });

  it('returns the tree with classified files', async () => {
    const { slug } = await createBook();
    const tree = (
      await app.inject({ method: 'GET', url: `/api/books/${slug}/tree` })
    ).json<BookTree>();
    const byPath = new Map(tree.files.map((file) => [file.path, file]));
    expect(byPath.get('story.md')).toMatchObject({ kind: 'story', title: 'The Salt Road' });
    expect(byPath.get('characters/_index.md')).toMatchObject({ kind: 'registry' });
    expect(byPath.get('continuity/state.md')).toMatchObject({ kind: 'state' });
  });

  it('adds, renames, and validates entities through the story CLI', async () => {
    const { slug } = await createBook();
    const added = await addEntity(slug, 'character', 'Mara Quill', { role: 'protagonist' });
    expect(added.statusCode).toBe(201);
    const outcome = added.json<StoryCommandOutcome>();
    expect(outcome.output).toBe('Created character mara-quill: ./characters/mara-quill.md');
    expect(outcome.validation).toMatchObject({ command: 'validate', ok: true });
    expect(outcome.checkpointId).not.toBeNull();

    const character = await readFile(slug, 'characters/mara-quill.md');
    expect(character).toMatchObject({
      kind: 'character',
      entityId: 'mara-quill',
      title: 'Mara Quill',
    });
    expect(character.frontmatter).toMatchObject({ role: 'protagonist' });

    const renamed = await app.inject({
      method: 'POST',
      url: `/api/books/${slug}/entities/character/mara-quill/rename`,
      payload: { name: 'Mara Venn' },
    });
    expect(renamed.statusCode).toBe(200);
    const tree = (
      await app.inject({ method: 'GET', url: `/api/books/${slug}/tree` })
    ).json<BookTree>();
    expect(tree.files.map((file) => file.path)).toContain('characters/mara-venn.md');
    expect(tree.files.map((file) => file.path)).not.toContain('characters/mara-quill.md');
    expect(tree.book.counts).toEqual({ character: 1 });
  });

  it('reports CLI refusals with their exit-code meaning', async () => {
    const { slug } = await createBook();
    await addEntity(slug, 'character', 'Mara');
    const duplicate = await addEntity(slug, 'character', 'Mara');
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toEqual({
      error: 'story_write_refused',
      message: 'characters/mara.md already exists',
    });

    const badOption = await addEntity(slug, 'character', 'Sera', { path: '/etc' });
    expect(badOption.statusCode).toBe(400);
    expect(badOption.json()).toMatchObject({ error: 'story_usage_error' });
  });

  it('writes files with an expected-hash precondition and refuses generated or unsafe paths', async () => {
    const { slug } = await createBook();
    const style = await readFile(slug, 'style-sheet.md');

    const stale = await app.inject({
      method: 'PUT',
      url: `/api/books/${slug}/files/style-sheet.md`,
      payload: { content: 'x', expectedHash: 'a'.repeat(64) },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: 'file_changed' });

    const saved = await app.inject({
      method: 'PUT',
      url: `/api/books/${slug}/files/style-sheet.md`,
      payload: { content: `${style.content}\nPrefer "grey".\n`, expectedHash: style.hash },
    });
    expect(saved.statusCode).toBe(200);
    const { file, checkpoint } = saved.json<{ file: BookFileDetail; checkpoint: Checkpoint }>();
    expect(file.hash).not.toBe(style.hash);
    expect(checkpoint).toMatchObject({
      label: 'Edit style-sheet.md',
      actor: 'user',
      files: [{ path: 'style-sheet.md', change: 'modified' }],
    });

    const created = await app.inject({
      method: 'PUT',
      url: `/api/books/${slug}/files/notes/ideas.md`,
      payload: { content: '# Ideas\n', expectedHash: null },
    });
    expect(created.statusCode).toBe(200);
    const again = await app.inject({
      method: 'PUT',
      url: `/api/books/${slug}/files/notes/ideas.md`,
      payload: { content: '# Ideas\n', expectedHash: null },
    });
    expect(again.json()).toMatchObject({
      error: 'file_changed',
      message: 'notes/ideas.md already exists.',
    });

    for (const [path, error] of [
      ['characters/_index.md', 'read_only_path'],
      ['cover.png', 'read_only_path'],
      ['dist/manuscript.md', 'read_only_path'],
      ['..%2Fescape.md', 'unsafe_path'],
      ['.git/config.md', 'unsafe_path'],
    ] as const) {
      const response = await app.inject({
        method: 'PUT',
        url: `/api/books/${slug}/files/${path}`,
        payload: { content: 'x', expectedHash: null },
      });
      expect({
        path,
        status: response.statusCode,
        error: response.json<{ error: string }>().error,
      }).toEqual({
        path,
        status: 400,
        error,
      });
    }
    expect(existsSync(join(dataDir, 'projects/escape.md'))).toBe(false);
  });

  it('reindexes registries when an entity file is edited directly, in one checkpoint', async () => {
    const { slug } = await createBook();
    await addEntity(slug, 'character', 'Mara Quill');
    const character = await readFile(slug, 'characters/mara-quill.md');
    const saved = await app.inject({
      method: 'PUT',
      url: `/api/books/${slug}/files/characters/mara-quill.md`,
      payload: {
        content: character.content.replace('name: Mara Quill', 'name: Mara Venn'),
        expectedHash: character.hash,
      },
    });
    expect(saved.statusCode).toBe(200);
    const { checkpoint } = saved.json<{ checkpoint: Checkpoint }>();
    expect(checkpoint.files.map((file) => file.path)).toEqual([
      'characters/_index.md',
      'characters/mara-quill.md',
    ]);
    const registry = await readFile(slug, 'characters/_index.md');
    expect(registry.content).toContain('Mara Venn');
    const validate = (
      await app.inject({ method: 'GET', url: `/api/books/${slug}/checks/validate` })
    ).json<BookCheckResult>();
    expect(validate.envelope.ok).toBe(true);
  });

  it('restores an entity file whose edit fails reindex and records no checkpoint', async () => {
    const { slug } = await createBook();
    await addEntity(slug, 'character', 'Mara Quill');
    const character = await readFile(slug, 'characters/mara-quill.md');
    const saved = await app.inject({
      method: 'PUT',
      url: `/api/books/${slug}/files/characters/mara-quill.md`,
      payload: {
        content: character.content.replace(
          'name: Mara Quill',
          'name: Mara Quill\narc: Starts certain,\n  ends unsure.',
        ),
        expectedHash: character.hash,
      },
    });
    expect(saved.statusCode).toBeGreaterThanOrEqual(400);
    expect((await readFile(slug, 'characters/mara-quill.md')).hash).toBe(character.hash);
    const checkpoints = (
      await app.inject({ method: 'GET', url: `/api/books/${slug}/checkpoints` })
    ).json<Checkpoint[]>();
    expect(checkpoints.map((checkpoint) => checkpoint.label)).not.toContain(
      'Edit characters/mara-quill.md (failed)',
    );
  });

  it('also restores registries a failed reindex had already rewritten', async () => {
    const { slug } = await createBook();
    await addEntity(slug, 'character', 'Mara Quill');
    const character = await readFile(slug, 'characters/mara-quill.md');
    const registry = await readFile(slug, 'characters/_index.md');
    const bookDir = join(dataDir, 'projects', slug);
    const original = StoryCli.prototype.runOrThrow;
    const spy = vi.spyOn(StoryCli.prototype, 'runOrThrow').mockImplementation(function (
      this: StoryCli,
      request,
    ) {
      if (request.command !== 'reindex') return original.call(this, request);
      // A reindex killed partway: one registry rewritten, one created, then the failure.
      writeFileSync(join(bookDir, 'characters/_index.md'), '# Half written\n');
      mkdirSync(join(bookDir, 'notes'), { recursive: true });
      writeFileSync(join(bookDir, 'notes/stray-registry.md'), '# New registry\n');
      return Promise.reject(new Error('story reindex timed out'));
    });
    try {
      const saved = await app.inject({
        method: 'PUT',
        url: `/api/books/${slug}/files/characters/mara-quill.md`,
        payload: {
          content: character.content.replace('name: Mara Quill', 'name: Mara Venn'),
          expectedHash: character.hash,
        },
      });
      expect(saved.statusCode).toBeGreaterThanOrEqual(400);
    } finally {
      spy.mockRestore();
    }
    expect((await readFile(slug, 'characters/mara-quill.md')).hash).toBe(character.hash);
    expect((await readFile(slug, 'characters/_index.md')).hash).toBe(registry.hash);
    expect(existsSync(join(bookDir, 'notes/stray-registry.md'))).toBe(false);
  });

  it('gives books created at the same time with the same title different folders', async () => {
    const created = await Promise.all([createBook('Twin'), createBook('Twin'), createBook('Twin')]);
    expect(created.map((book) => book.slug).sort()).toEqual(['twin', 'twin-2', 'twin-3']);
  });

  it('records checkpoints with diffs and undoes them last-in-first-out', async () => {
    const { slug } = await createBook();
    const first = (await addEntity(slug, 'character', 'Mara Quill')).json<StoryCommandOutcome>();
    const second = (await addEntity(slug, 'location', 'Port Kestrel')).json<StoryCommandOutcome>();

    const detail = (
      await app.inject({
        method: 'GET',
        url: `/api/books/${slug}/checkpoints/${second.checkpointId}`,
      })
    ).json<CheckpointDetail>();
    const created = detail.files.find(
      (file) => file.path === 'worldbuilding/locations/port-kestrel.md',
    );
    expect(created).toMatchObject({ change: 'created', before: null });
    expect(created?.after).toContain('Port Kestrel');
    expect(detail.files.map((file) => file.path)).toContain('worldbuilding/_index.md');

    const outOfOrder = await app.inject({
      method: 'POST',
      url: `/api/books/${slug}/checkpoints/${first.checkpointId}/undo`,
    });
    expect(outOfOrder.statusCode).toBe(409);
    expect(outOfOrder.json()).toMatchObject({ error: 'checkpoint_not_latest' });

    const undone = await app.inject({
      method: 'POST',
      url: `/api/books/${slug}/checkpoints/${second.checkpointId}/undo`,
    });
    expect(undone.statusCode).toBe(200);
    expect(undone.json<Checkpoint>().undoneAt).not.toBeNull();
    expect(
      existsSync(join(dataDir, `projects/${slug}/worldbuilding/locations/port-kestrel.md`)),
    ).toBe(false);
    const registry = await readFile(slug, 'worldbuilding/_index.md');
    expect(registry.content).not.toContain('port-kestrel');

    const list = (await app.inject({ method: 'GET', url: `/api/books/${slug}/checkpoints` })).json<
      Checkpoint[]
    >();
    expect(list.map((checkpoint) => checkpoint.label)).toEqual([
      'Add location Port Kestrel',
      'Add character Mara Quill',
    ]);
  });

  it('refuses to undo over a later edit', async () => {
    const { slug } = await createBook();
    const added = (await addEntity(slug, 'character', 'Mara')).json<StoryCommandOutcome>();
    writeFileSync(
      join(dataDir, `projects/${slug}/characters/mara.md`),
      '---\nname: Mara\n---\nEdited.\n',
    );
    const response = await app.inject({
      method: 'POST',
      url: `/api/books/${slug}/checkpoints/${added.checkpointId}/undo`,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: 'checkpoint_conflict' });
    expect(response.json<{ message: string }>().message).toContain('characters/mara.md');
  });

  it('picks up edits made outside the app and searches them', async () => {
    const { slug } = await createBook();
    await addEntity(slug, 'character', 'Mara Quill');
    const path = join(dataDir, `projects/${slug}/characters/mara-quill.md`);
    writeFileSync(
      path,
      readFileSync(path, 'utf8').replace(
        '## Appearance',
        '## Appearance\n\nA lighthouse-keeper with salt-grey eyes.',
      ),
    );

    const results = (
      await app.inject({ method: 'GET', url: `/api/books/${slug}/search?q=lighthouse` })
    ).json<BookSearchResult[]>();
    expect(results).toEqual([
      expect.objectContaining({
        path: 'characters/mara-quill.md',
        kind: 'character',
        title: 'Mara Quill',
      }),
    ]);
    expect(results[0]?.excerpt).toContain('lighthouse');
  });

  it('runs checks as JSON and caches them until the book changes', async () => {
    const { slug } = await createBook();
    const report = await app.inject({ method: 'GET', url: `/api/books/${slug}/checks/report` });
    expect(report.statusCode).toBe(200);
    expect(report.json<BookCheckResult>()).toMatchObject({
      command: 'report',
      exitCode: 0,
      envelope: { ok: true, data: { title: 'The Salt Road', root: '.' } },
    });

    writeFileSync(join(dataDir, `projects/${slug}/characters/ghost.md`), '---\nname: Ghost\n---\n');
    const validate = (
      await app.inject({ method: 'GET', url: `/api/books/${slug}/checks/validate` })
    ).json<BookCheckResult>();
    expect(validate.exitCode).toBe(1);
    expect(validate.envelope.ok).toBe(false);

    const unknown = await app.inject({ method: 'GET', url: `/api/books/${slug}/checks/build` });
    expect(unknown.statusCode).toBe(400);
  });

  it('runs check, grid, list, and mentions, passing list and mentions their arguments', async () => {
    const { slug } = await createBook();
    await app.inject({
      method: 'POST',
      url: `/api/books/${slug}/entities`,
      payload: { kind: 'character', name: 'Mara Quill', options: {} },
    });
    const run = async (command: string, query = '') =>
      (
        await app.inject({ method: 'GET', url: `/api/books/${slug}/checks/${command}${query}` })
      ).json<BookCheckResult>();

    expect((await run('check')).envelope.data).toMatchObject({ errors: 0 });
    expect((await run('grid')).envelope.data).toHaveProperty('rows');
    expect((await run('mentions')).envelope.data).toMatchObject({ mode: 'audit' });

    const listed = await run('list', '?kind=characters&where=status');
    expect(listed.envelope.data).toMatchObject({
      kind: 'characters',
      where: [{ key: 'status', op: 'present' }],
      items: [{ id: 'mara-quill' }],
    });
    const mentioned = await run('mentions', '?kind=character&id=mara-quill');
    expect(mentioned.envelope.data).toMatchObject({ mode: 'entity', id: 'mara-quill' });

    // A list without a kind is the CLI's usage error, returned as a result.
    const bare = await run('list');
    expect(bare.exitCode).toBe(2);
    expect(bare.envelope.diagnostics[0]?.message).toMatch(/^Usage: story list/u);
    const bad = await app.inject({
      method: 'GET',
      url: `/api/books/${slug}/checks/mentions?kind=character&id=..%2Fx`,
    });
    expect(bad.statusCode).toBe(400);
    const idWithoutKind = await app.inject({
      method: 'GET',
      url: `/api/books/${slug}/checks/mentions?id=mara-quill`,
    });
    expect(idWithoutKind.statusCode).toBe(400);
  });

  it('moves a trashed book out of the library', async () => {
    const { slug } = await createBook();
    const response = await app.inject({ method: 'DELETE', url: `/api/books/${slug}` });
    expect(response.statusCode).toBe(204);
    expect(existsSync(join(dataDir, `projects/${slug}`))).toBe(false);
    expect(readdirSync(join(dataDir, 'trash'))[0]).toMatch(/^the-salt-road-/u);
    expect((await app.inject({ method: 'GET', url: `/api/books/${slug}` })).statusCode).toBe(404);
  });

  it('404s unknown books and files', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/books/nope/tree' })).statusCode).toBe(404);
    const { slug } = await createBook();
    expect(
      (await app.inject({ method: 'GET', url: `/api/books/${slug}/files/nope.md` })).statusCode,
    ).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/books/Bad_Slug' })).statusCode).toBe(400);
  });
});

describe('builds', () => {
  async function bookWithChapter(): Promise<string> {
    const book = await createBook();
    expect((await addEntity(book.slug, 'chapter', 'Arrival')).statusCode).toBe(201);
    const chapter = join(dataDir, 'projects', book.slug, 'chapters/chapter-01.md');
    writeFileSync(chapter, `${readFileSync(chapter, 'utf8')}\nMara stepped off the ferry.\n`);
    return book.slug;
  }

  it('builds an EPUB into dist/, lists it, downloads it, and removes it', async () => {
    const slug = await bookWithChapter();
    expect((await app.inject({ method: 'GET', url: `/api/books/${slug}/builds` })).json()).toEqual(
      [],
    );

    const built = await app.inject({
      method: 'POST',
      url: `/api/books/${slug}/builds`,
      payload: { format: 'epub' },
    });
    expect(built.statusCode).toBe(201);
    const result = built.json<BookBuildResult>();
    expect(result.file).toMatchObject({ name: 'the-salt-road.epub' });
    expect(result.file.size).toBeGreaterThan(0);
    expect(result.output).toContain('as epub to ./dist/the-salt-road.epub');
    expect(result.output).not.toContain(dataDir);

    const listed = await app.inject({ method: 'GET', url: `/api/books/${slug}/builds` });
    expect(listed.json<BookBuildFile[]>().map((file) => file.name)).toEqual(['the-salt-road.epub']);

    const download = await app.inject({
      method: 'GET',
      url: `/api/books/${slug}/builds/the-salt-road.epub`,
    });
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-type']).toBe('application/epub+zip');
    expect(download.headers['content-disposition']).toBe(
      "attachment; filename*=UTF-8''the-salt-road.epub",
    );
    expect(download.rawPayload.subarray(0, 2).toString()).toBe('PK');

    // Builds are not book content: no checkpoint, nothing in the tree.
    const checkpoints = await app.inject({ method: 'GET', url: `/api/books/${slug}/checkpoints` });
    expect(checkpoints.json<Checkpoint[]>().every((entry) => entry.label !== 'build')).toBe(true);
    const tree = await app.inject({ method: 'GET', url: `/api/books/${slug}/tree` });
    expect(tree.json<BookTree>().files.some((file) => file.path.startsWith('dist/'))).toBe(false);

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/books/${slug}/builds/the-salt-road.epub`,
    });
    expect(removed.statusCode).toBe(204);
    expect(existsSync(join(dataDir, 'projects', slug, 'dist/the-salt-road.epub'))).toBe(false);
  });

  it('serves an HTML review copy only as a sandboxed download', async () => {
    const slug = await bookWithChapter();
    const built = await app.inject({
      method: 'POST',
      url: `/api/books/${slug}/builds`,
      payload: { format: 'html', stamp: 'round-2' },
    });
    expect(built.statusCode).toBe(201);
    const download = await app.inject({
      method: 'GET',
      url: `/api/books/${slug}/builds/${built.json<BookBuildResult>().file.name}`,
    });
    expect(download.headers['content-security-policy']).toContain('sandbox');
    expect(download.headers['x-content-type-options']).toBe('nosniff');
    expect(download.body).toContain('round-2');
  });

  it('refuses options that do not apply to the format, and bad file names', async () => {
    const slug = await bookWithChapter();
    const mismatched = await app.inject({
      method: 'POST',
      url: `/api/books/${slug}/builds`,
      payload: { format: 'epub', trim: '6x9' },
    });
    expect(mismatched.statusCode).toBe(400);

    for (const name of ['..%2Fstory.md', '%2E%2E', '.hidden', 'missing.epub']) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/books/${slug}/builds/${name}`,
      });
      expect([400, 404]).toContain(response.statusCode);
    }
  });

  it('returns the file when story.md promotes a build warning to an error', async () => {
    const book = await createBook();
    expect((await addEntity(book.slug, 'chapter', 'Arrival')).statusCode).toBe(201);
    const story = join(dataDir, 'projects', book.slug, 'story.md');
    writeFileSync(
      story,
      readFileSync(story, 'utf8').replace(
        /^---\n/u,
        '---\nseverity:\n  - warning: empty-chapter\n    level: error\n',
      ),
    );
    const response = await app.inject({
      method: 'POST',
      url: `/api/books/${book.slug}/builds`,
      payload: { format: 'markdown' },
    });
    expect(response.statusCode).toBe(201);
    const result = response.json<BookBuildResult>();
    expect(result.file.name).toBe('the-salt-road.md');
    expect(result.output).toContain('empty-chapter');
  });

  it('reports a book with nothing to build as an unusable project', async () => {
    const book = await createBook('Empty');
    const response = await app.inject({
      method: 'POST',
      url: `/api/books/${book.slug}/builds`,
      payload: { format: 'markdown' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: 'story_unusable_project' });
  });
});

describe('interactive books', () => {
  async function threeChapters(title?: string): Promise<string> {
    const book = await createBook(title);
    for (const [name, prose] of [
      ['Harbor Wall', 'Mara climbs the wall.'],
      ['Down to the Water', 'The steps are slick.'],
      ['The Archive', 'Venn is still awake.'],
    ] as const) {
      expect((await addEntity(book.slug, 'chapter', name)).statusCode).toBe(201);
      const index = readdirSync(join(dataDir, 'projects', book.slug, 'chapters')).filter((file) =>
        /^chapter-\d+\.md$/u.test(file),
      ).length;
      const path = join(dataDir, 'projects', book.slug, `chapters/chapter-0${index}.md`);
      writeFileSync(path, `${readFileSync(path, 'utf8')}\n${prose}\n`);
    }
    return book.slug;
  }

  const chapterPath = (slug: string, number: number) =>
    join(dataDir, 'projects', slug, `chapters/chapter-0${number}.md`);

  /** Replaces a chapter's ink: everything under its `## Chapter Text`. */
  function writeInk(slug: string, number: number, ink: string): void {
    const path = chapterPath(slug, number);
    const text = readFileSync(path, 'utf8');
    const at = text.indexOf('## Chapter Text');
    writeFileSync(path, `${text.slice(0, at)}## Chapter Text\n\n${ink}\n`);
  }

  async function preview(slug: string) {
    const response = await app.inject({ method: 'GET', url: `/api/books/${slug}/ink-conversion` });
    expect(response.statusCode).toBe(200);
    return inkConversionPreviewSchema.parse(response.json());
  }

  /** Converts as the writer does: the conversion the preview showed, named by its token. */
  async function convert(slug: string): Promise<BookSummary> {
    const { token } = await preview(slug);
    const response = await app.inject({
      method: 'POST',
      url: `/api/books/${slug}/ink-conversion`,
      payload: { token },
    });
    expect(response.statusCode).toBe(200);
    return response.json<BookSummary>();
  }

  /** Every Markdown file in a book and its content. */
  function bookFiles(slug: string): Map<string, string> {
    const root = join(dataDir, 'projects', slug);
    return new Map(
      readdirSync(root, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
        .map((entry) => {
          const path = join(entry.parentPath, entry.name);
          return [path.slice(root.length + 1), readFileSync(path, 'utf8')];
        }),
    );
  }

  async function story(slug: string): Promise<InteractiveStory> {
    const response = await app.inject({ method: 'GET', url: `/api/books/${slug}/story` });
    expect(response.statusCode).toBe(200);
    return interactiveStorySchema.parse(response.json());
  }

  async function play(slug: string): Promise<BookPlay> {
    const response = await app.inject({ method: 'GET', url: `/api/books/${slug}/play` });
    expect(response.statusCode).toBe(200);
    // The web client parses it strictly, so it must be exactly the schema.
    return bookPlaySchema.parse(response.json());
  }

  const summary = async (slug: string) =>
    (await app.inject({ method: 'GET', url: `/api/books/${slug}` })).json<BookSummary>();

  it('converts a book to ink chapters after a preview, plays it, and can undo it', async () => {
    const slug = await threeChapters();
    expect(await summary(slug)).toMatchObject({ interactive: false, needsInkConversion: false });
    const refused = await app.inject({ method: 'GET', url: `/api/books/${slug}/play` });
    expect(refused.json()).toMatchObject({ error: 'not_interactive' });

    const reviewed = await preview(slug);
    expect(reviewed.files.map((file) => file.path)).toEqual([
      'chapters/chapter-01.md',
      'chapters/chapter-02.md',
      'chapters/chapter-03.md',
      'ink/variables.md',
      'story.md',
    ]);
    // Nothing is written until the conversion is applied.
    expect(readFileSync(chapterPath(slug, 1), 'utf8')).not.toContain('-> chapter_02');

    expect(await convert(slug)).toMatchObject({ interactive: true, needsInkConversion: false });
    const first = readFileSync(chapterPath(slug, 1), 'utf8');
    // The outline stays Markdown; the ink is the chapter text.
    expect(first).toContain('## Outline\n');
    expect(first).toMatch(/## Chapter Text\n\nMara climbs the wall\.\n\n-> chapter_02\n$/u);

    const read = await story(slug);
    expect(read).toMatchObject({ compiled: true, start: 'chapter_01' });
    expect(read.chapters.map((chapter) => chapter.knot)).toEqual([
      'chapter_01',
      'chapter_02',
      'chapter_03',
    ]);
    expect(read.diagnostics.filter((entry) => entry.severity === 'error')).toEqual([]);
    const ink = new Story((await play(slug)).story);
    expect(ink.ContinueMaximally().trim()).toBe(
      'Mara climbs the wall.\nThe steps are slick.\nVenn is still awake.',
    );

    const checkpoints = (
      await app.inject({ method: 'GET', url: `/api/books/${slug}/checkpoints` })
    ).json<Checkpoint[]>();
    const conversion = checkpoints.find((entry) => entry.label === 'Convert to ink chapters')!;
    const undone = await app.inject({
      method: 'POST',
      url: `/api/books/${slug}/checkpoints/${conversion.id}/undo`,
    });
    expect(undone.statusCode).toBe(200);
    expect(await summary(slug)).toMatchObject({ interactive: false });
    expect(readFileSync(chapterPath(slug, 1), 'utf8')).not.toContain('-> chapter_02');
  }, 30_000);

  it('converts only what the writer reviewed: a book changed since the preview is refused', async () => {
    const slug = await threeChapters();
    const { token } = await preview(slug);
    const path = chapterPath(slug, 2);
    writeFileSync(path, `${readFileSync(path, 'utf8')}\nA line written after the preview.\n`);
    const before = bookFiles(slug);
    const stale = await app.inject({
      method: 'POST',
      url: `/api/books/${slug}/ink-conversion`,
      payload: { token },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: 'file_changed' });
    expect(bookFiles(slug)).toEqual(before);
    expect(await summary(slug)).toMatchObject({ interactive: false });
  }, 30_000);

  it('puts every file back when the conversion fails partway', async () => {
    const slug = await threeChapters();
    const bookDir = join(dataDir, 'projects', slug);
    const before = bookFiles(slug);
    const { token } = await preview(slug);
    const original = StoryCli.prototype.runOrThrow;
    const spy = vi.spyOn(StoryCli.prototype, 'runOrThrow').mockImplementation(function (
      this: StoryCli,
      request,
    ) {
      if (request.command !== 'reindex') return original.call(this, request);
      // A reindex killed partway: a registry rewritten, then the failure.
      writeFileSync(join(bookDir, 'chapters/_index.md'), '# Half written\n');
      return Promise.reject(new Error('story reindex timed out'));
    });
    try {
      const failed = await app.inject({
        method: 'POST',
        url: `/api/books/${slug}/ink-conversion`,
        payload: { token },
      });
      expect(failed.statusCode).toBeGreaterThanOrEqual(400);
    } finally {
      spy.mockRestore();
    }
    expect(bookFiles(slug)).toEqual(before);
    expect(await summary(slug)).toMatchObject({ interactive: false });
  }, 30_000);

  it('refuses to convert choices in the earlier format it cannot carry over', async () => {
    const slug = await threeChapters();
    const path = chapterPath(slug, 2);
    writeFileSync(
      path,
      readFileSync(path, 'utf8').replace(
        /^---\n/u,
        '---\nchoices:\n  - text: Go on\n    to: chapter-03\n  - to: chapter-01\n  - text: Nowhere\n    to: chapter-09\n',
      ),
    );
    const before = bookFiles(slug);
    const refused = await app.inject({ method: 'GET', url: `/api/books/${slug}/ink-conversion` });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ error: 'legacy_choices_invalid' });
    const message = refused.json<{ message: string }>().message;
    expect(message).toContain('chapters/chapter-02.md: choice 2 has no text');
    expect(message).toContain(
      'chapters/chapter-02.md: choice 3 leads to chapter-09, which is not a chapter',
    );
    const edition = await app.inject({
      method: 'POST',
      url: `/api/books/${slug}/interactive-edition`,
    });
    expect(edition.json()).toMatchObject({ error: 'legacy_choices_invalid' });
    expect(bookFiles(slug)).toEqual(before);
  }, 30_000);

  it('converts frontmatter choices from the earlier format into ink choices', async () => {
    const slug = await threeChapters();
    const path = chapterPath(slug, 1);
    writeFileSync(
      path,
      readFileSync(path, 'utf8').replace(
        /^---\n/u,
        '---\nchoices:\n  - text: Light the lamp\n    to: chapter-02\n    sets: ["lamp_lit"]\n  - text: Read the archive\n    to: chapter-03\n',
      ),
    );
    expect(await summary(slug)).toMatchObject({ interactive: false, needsInkConversion: true });
    await convert(slug);
    const ink = new Story((await play(slug)).story);
    expect(ink.ContinueMaximally().trim()).toBe('Mara climbs the wall.');
    expect(ink.currentChoices.map((choice: { text: string }) => choice.text)).toEqual([
      'Light the lamp',
      'Read the archive',
    ]);
    ink.ChooseChoiceIndex(0);
    expect(ink.ContinueMaximally().trim()).toBe('The steps are slick.');
    expect(ink.variablesState.$('lamp_lit')).toBe(true);
  }, 30_000);

  it('reports compile errors at the chapter line, and will not play until they are fixed', async () => {
    const slug = await threeChapters();
    await convert(slug);
    writeInk(slug, 2, 'The steps are {slick.\n-> END');
    const read = await story(slug);
    expect(read.compiled).toBe(false);
    const error = read.diagnostics.find((entry) => entry.severity === 'error')!;
    expect(error.path).toBe('chapters/chapter-02.md');
    expect(readFileSync(chapterPath(slug, 2), 'utf8').split('\n')[error.line! - 1]).toBe(
      'The steps are {slick.',
    );
    const refused = await app.inject({ method: 'GET', url: `/api/books/${slug}/play` });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ error: 'ink_compile_failed' });
    expect(refused.json<{ message: string }>().message).toContain('chapters/chapter-02.md:');
  }, 30_000);

  it("checks a file's unsaved ink against the story without writing it", async () => {
    const slug = await threeChapters();
    await convert(slug);
    const path = chapterPath(slug, 2);
    const saved = readFileSync(path, 'utf8');
    const unsaved = saved.replace('The steps are slick.', 'The steps are {slick.');
    const response = await app.inject({
      method: 'POST',
      url: `/api/books/${slug}/ink-check`,
      payload: { path: 'chapters/chapter-02.md', content: unsaved },
    });
    expect(response.statusCode).toBe(200);
    const checked = interactiveStorySchema.parse(response.json());
    expect(checked.compiled).toBe(false);
    const error = checked.diagnostics.find((entry) => entry.severity === 'error')!;
    expect(error.path).toBe('chapters/chapter-02.md');
    expect(unsaved.split('\n')[error.line! - 1]).toBe('The steps are {slick.');
    expect(readFileSync(path, 'utf8')).toBe(saved);
    expect((await story(slug)).compiled).toBe(true);

    const outside = await app.inject({
      method: 'POST',
      url: `/api/books/${slug}/ink-check`,
      payload: { path: '_index.md', content: '' },
    });
    expect(outside.statusCode).toBeGreaterThanOrEqual(400);
  }, 30_000);

  it('reads the story structure: choices, conditions, stitches, variables, and what nothing reaches', async () => {
    const slug = await threeChapters();
    await convert(slug);
    writeInk(
      slug,
      1,
      [
        'Mara climbs the wall.',
        '* {trust > 0} [Wave] She waves.',
        '    ~ trust += 1',
        '    -> chapter_02',
        '+ [Wait] -> cellar',
        '= cellar',
        'Dark. -> chapter_02',
      ].join('\n'),
    );
    writeFileSync(
      join(dataDir, 'projects', slug, 'ink/variables.md'),
      '---\ntitle: Story variables\n---\nVAR trust = 1\n',
    );
    writeInk(slug, 2, 'The steps are slick.\n-> END');
    const read = await story(slug);
    expect(read.compiled).toBe(true);
    const first = read.nodes.find((node) => node.name === 'chapter_01')!;
    expect(first.choices).toMatchObject([
      { text: 'Wave', once: true, condition: 'trust > 0', target: 'chapter_02', writes: ['trust'] },
      { text: 'Wait', once: false, condition: null, target: 'chapter_01.cellar' },
    ]);
    expect(read.nodes.find((node) => node.name === 'chapter_01.cellar')).toMatchObject({
      kind: 'stitch',
      reachable: true,
    });
    expect(read.variables).toEqual([
      { name: 'trust', kind: 'var', initial: '1', path: 'ink/variables.md', line: 4 },
    ]);
    expect(read.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        message: 'Nothing leads to The Archive (chapter_03)',
      }),
    );
  }, 30_000);

  it('edits a chapter ending, declaring what it sets, and refuses one that does not compile', async () => {
    const slug = await threeChapters();
    await convert(slug);
    const url = `/api/books/${slug}/chapters/chapter-01/ending`;
    const detail = chapterEndingDetailSchema.parse(
      (await app.inject({ method: 'GET', url })).json(),
    );
    expect(detail).toMatchObject({ editable: true, ending: { choices: [], then: 'chapter_02' } });

    const ending = {
      then: 'END',
      choices: [
        {
          text: 'Light the lamp',
          once: true,
          condition: '',
          effects: ['lamp_lit = true'],
          to: 'chapter_02',
        },
        { text: 'Read', once: false, condition: 'lamp_lit', effects: [], to: 'chapter_03' },
      ],
    };
    const saved = await app.inject({
      method: 'PUT',
      url,
      payload: { expectedHash: detail.hash, ending },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json<ChapterEndingDetail>().ending).toEqual(ending);
    expect(readFileSync(join(dataDir, 'projects', slug, 'ink/variables.md'), 'utf8')).toContain(
      'VAR lamp_lit = false',
    );
    const ink = new Story((await play(slug)).story);
    ink.ContinueMaximally();
    expect(ink.currentChoices.map((choice: { text: string }) => choice.text)).toEqual([
      'Light the lamp',
    ]);

    const stale = await app.inject({
      method: 'PUT',
      url,
      payload: { expectedHash: detail.hash, ending },
    });
    expect(stale.json()).toMatchObject({ error: 'file_changed' });
    const broken = await app.inject({
      method: 'PUT',
      url,
      payload: {
        expectedHash: saved.json<ChapterEndingDetail>().hash,
        ending: { then: 'END', choices: [{ ...ending.choices[0], to: 'nowhere' }] },
      },
    });
    expect(broken.statusCode).toBe(400);
    expect(broken.json<{ message: string }>().message).toContain('nowhere');
  }, 30_000);

  it('exports ink, compiled JSON, and a web page that plays the story', async () => {
    const slug = await threeChapters();
    const linear = await app.inject({
      method: 'POST',
      url: `/api/books/${slug}/builds`,
      payload: { format: 'ink' },
    });
    expect(linear.json()).toMatchObject({ error: 'build_format' });
    await convert(slug);
    const epub = await app.inject({
      method: 'POST',
      url: `/api/books/${slug}/builds`,
      payload: { format: 'epub' },
    });
    expect(epub.json()).toMatchObject({ error: 'build_format' });

    const built: Record<string, string> = {};
    for (const format of ['ink', 'ink-json', 'web'] as const) {
      const response = await app.inject({
        method: 'POST',
        url: `/api/books/${slug}/builds`,
        payload: { format },
      });
      expect(response.statusCode).toBe(201);
      const name = response.json<BookBuildResult>().file.name;
      built[format] = (
        await app.inject({ method: 'GET', url: `/api/books/${slug}/builds/${name}` })
      ).body;
    }
    expect(built.ink).toContain('=== chapter_01 ===\n# chapter: Harbor Wall\n');
    expect(JSON.parse(built['ink-json']!)).toMatchObject({ inkVersion: expect.any(Number) });
    expect(built.web).toContain('<title>The Salt Road</title>');
    expect(built.web).toContain('inkjs');
    expect(built.web).not.toMatch(
      /<\/script>[\s\S]*<\/script>[\s\S]*<\/script>[\s\S]*<\/script>[\s\S]*<\/script>/u,
    );
  }, 30_000);

  it('searches, checks, and reads an interactive book as prose', async () => {
    const slug = await threeChapters();
    await convert(slug);
    writeInk(slug, 1, 'Waves {trust > 0: greet a friend|ignore a stranger}.\n-> chapter_02');
    const hits = (
      await app.inject({ method: 'GET', url: `/api/books/${slug}/search?q=stranger` })
    ).json<BookSearchResult[]>();
    expect(hits.map((hit) => hit.path)).toContain('chapters/chapter-01.md');
    const logic = (
      await app.inject({ method: 'GET', url: `/api/books/${slug}/search?q=chapter_02` })
    ).json<BookSearchResult[]>();
    expect(logic).toEqual([]);

    const report = await app.inject({ method: 'GET', url: `/api/books/${slug}/checks/report` });
    expect(report.statusCode).toBe(200);
    const manuscript = (
      await app.inject({ method: 'GET', url: `/api/books/${slug}/manuscript` })
    ).json<{ markdown: string }>();
    expect(manuscript.markdown).toContain(
      '# Harbor Wall\n\nWaves greet a friend ignore a stranger.',
    );
    expect(manuscript.markdown).not.toContain('->');
  }, 30_000);

  it('copies a book as a separate interactive edition in ink, leaving the original as it was', async () => {
    const slug = await threeChapters();
    const before = readFileSync(join(dataDir, 'projects', slug, 'story.md'), 'utf8');
    const created = await app.inject({
      method: 'POST',
      url: `/api/books/${slug}/interactive-edition`,
      payload: { title: 'The Salt Road: Choices' },
    });
    expect(created.statusCode).toBe(201);
    const edition = created.json<BookSummary>();
    expect(edition).toMatchObject({ title: 'The Salt Road: Choices', interactive: true });
    expect(edition.slug).not.toBe(slug);
    expect(existsSync(join(dataDir, 'projects', edition.slug, '.gitignore'))).toBe(true);
    const story = readFileSync(join(dataDir, 'projects', edition.slug, 'story.md'), 'utf8');
    expect(story).toMatch(
      /^ifid: [0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/mu,
    );
    expect(story).toMatch(/^interactive: true$/mu);
    expect(readFileSync(join(dataDir, 'projects', slug, 'story.md'), 'utf8')).toBe(before);
    expect(new Story((await play(edition.slug)).story).ContinueMaximally()).toContain(
      'Venn is still awake.',
    );
  }, 30_000);

  it('copies a book with a long title into an edition that plays', async () => {
    const title =
      'The Extraordinarily Long and Winding Chronicle of the Salt Road Across the Sea and the Ships That Sailed It';
    const slug = await threeChapters(title);
    const created = await app.inject({
      method: 'POST',
      url: `/api/books/${slug}/interactive-edition`,
    });
    expect(created.statusCode).toBe(201);
    const edition = created.json<BookSummary>();
    expect(edition.title).toBe(`${title} (interactive edition)`);
    const played = await play(edition.slug);
    expect(played.title).toBe(edition.title);
    expect(played.ifid).toMatch(/^[0-9A-F-]{36}$/u);
  }, 30_000);

  it('gives a story an IFID once', async () => {
    const slug = await threeChapters();
    const pinned = await app.inject({ method: 'POST', url: `/api/books/${slug}/ifid` });
    const ifid = pinned.json<{ ifid: string }>().ifid;
    expect(ifid).toMatch(/^[0-9A-F-]{36}$/u);
    const again = await app.inject({ method: 'POST', url: `/api/books/${slug}/ifid` });
    expect(again.json<{ ifid: string }>().ifid).toBe(ifid);
    // An IFID alone marks a book made interactive the earlier way.
    expect(await summary(slug)).toMatchObject({ interactive: false, needsInkConversion: true });
  }, 30_000);
});

describe('manuscript', () => {
  it('returns chapter prose only, without frontmatter or outlines, and writes nothing', async () => {
    const book = await createBook();
    expect((await addEntity(book.slug, 'chapter', 'Arrival')).statusCode).toBe(201);
    const chapter = join(dataDir, 'projects', book.slug, 'chapters/chapter-01.md');
    writeFileSync(chapter, `${readFileSync(chapter, 'utf8')}\nMara stepped off the ferry.\n`);
    expect((await addEntity(book.slug, 'chapter', 'The Bell')).statusCode).toBe(201);
    const before = readdirSync(tmpdir()).filter((name) =>
      name.startsWith('worldbookllm-manuscript-'),
    );

    const response = await app.inject({ method: 'GET', url: `/api/books/${book.slug}/manuscript` });
    expect(response.statusCode).toBe(200);
    const manuscript = response.json<{ markdown: string; warnings: string[] }>();
    expect(manuscript.markdown).toContain('# Chapter 1: Arrival');
    expect(manuscript.markdown).toContain('Mara stepped off the ferry.');
    expect(manuscript.markdown).not.toContain('## Outline');
    expect(manuscript.markdown).not.toContain('status:');
    expect(manuscript.warnings.join('\n')).toContain('chapters/chapter-02.md has no prose yet');
    expect(manuscript.warnings.join('\n')).not.toContain(dataDir);

    expect(existsSync(join(dataDir, 'projects', book.slug, 'dist'))).toBe(false);
    const after = readdirSync(tmpdir()).filter((name) =>
      name.startsWith('worldbookllm-manuscript-'),
    );
    expect(after).toEqual(before);
  });

  it('returns an empty manuscript for a book with no chapters', async () => {
    const book = await createBook();
    const response = await app.inject({ method: 'GET', url: `/api/books/${book.slug}/manuscript` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ markdown: '', warnings: [] });
  });

  it('still reports a book export cannot read as an error', async () => {
    const book = await createBook();
    expect((await addEntity(book.slug, 'chapter', 'Arrival')).statusCode).toBe(201);
    // A chapter whose frontmatter fails to parse: export refuses rather than drop it.
    writeFileSync(
      join(dataDir, 'projects', book.slug, 'chapters/chapter-01.md'),
      '---\ntitle: Arrival\ntitle: Again\n---\n\nProse.\n',
    );
    const response = await app.inject({ method: 'GET', url: `/api/books/${book.slug}/manuscript` });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ message: string }>().message).toContain('Cannot export');
  });
});
