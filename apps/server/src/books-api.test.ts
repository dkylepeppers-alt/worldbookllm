import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  BookCheckResult,
  BookFileDetail,
  BookSearchResult,
  BookSummary,
  BookTree,
  Checkpoint,
  CheckpointDetail,
  StoryCommandOutcome,
} from '@worldbookllm/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';

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
