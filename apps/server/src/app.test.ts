import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import matter from 'gray-matter';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import { fixture } from './services/converters/__fixtures__/load.js';

function multipartUpload(fileName: string, body: Buffer, contentType = 'application/octet-stream') {
  const boundary = 'worldbookllm-boundary';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${contentType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([head, body, tail]),
  };
}

describe('server data API', () => {
  let app: FastifyInstance;
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'worldbookllm-app-'));
    app = buildApp({ dataDir, logger: false });
  });

  afterEach(async () => {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function createNotebook(name = 'Atlas') {
    const response = await app.inject({
      method: 'POST',
      url: '/api/notebooks',
      payload: { name },
    });
    expect(response.statusCode).toBe(201);
    return response.json<{
      id: string;
      name: string;
      settings: unknown;
      createdAt: string;
      updatedAt: string;
    }>();
  }

  it('keeps the health endpoint available', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('creates, lists, reads, and patches notebooks', async () => {
    const notebook = await createNotebook(' Atlas ');
    expect(notebook).toEqual({
      id: expect.any(String),
      name: 'Atlas',
      settings: null,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });

    const list = await app.inject({ method: 'GET', url: '/api/notebooks' });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual([notebook]);

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/notebooks/${notebook.id}`,
      payload: {
        name: 'Revised Atlas',
        settings: { source: 'nanogpt', model: 'meta/llama' },
      },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json()).toEqual({
      ...notebook,
      name: 'Revised Atlas',
      settings: { source: 'nanogpt', model: 'meta/llama' },
      updatedAt: expect.any(String),
    });

    const detail = await app.inject({
      method: 'GET',
      url: `/api/notebooks/${notebook.id}`,
    });
    expect(detail.json()).toEqual(patch.json());
  });

  it('returns stable validation and not-found errors', async () => {
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/notebooks',
      payload: { name: '' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toEqual({
      error: 'validation_error',
      message: 'Invalid request',
      issues: expect.any(Array),
    });

    const emptyPatch = await app.inject({
      method: 'PATCH',
      url: '/api/notebooks/f9942d0a-eaca-41a8-a3d8-87987cc173fd',
      payload: {},
    });
    expect(emptyPatch.statusCode).toBe(400);

    const missing = await app.inject({
      method: 'GET',
      url: '/api/notebooks/f9942d0a-eaca-41a8-a3d8-87987cc173fd',
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({
      error: 'not_found',
      message: 'Notebook f9942d0a-eaca-41a8-a3d8-87987cc173fd was not found',
    });
  });

  it('persists pasted sources as Markdown and keeps content out of SQLite', async () => {
    const notebook = await createNotebook();
    const create = await app.inject({
      method: 'POST',
      url: `/api/notebooks/${notebook.id}/sources`,
      payload: { title: 'Amber Court', content: '# Court\n\nAmber rules here.' },
    });
    expect(create.statusCode).toBe(201);
    const source = create.json<{
      id: string;
      notebookId: string;
      title: string;
      slug: string;
      filePath: string;
      wordCount: number;
      contentHash: string;
      origin: { type: string };
      conversionNotes: string[];
      createdAt: string;
      updatedAt: string;
    }>();
    expect(source).toEqual({
      id: expect.any(String),
      notebookId: notebook.id,
      title: 'Amber Court',
      slug: 'amber-court',
      filePath: expect.stringMatching(/\.md$/u),
      origin: { type: 'paste' },
      conversionNotes: [],
      category: null,
      tags: [],
      wordCount: 5,
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });

    const markdown = readFileSync(join(dataDir, source.filePath), 'utf8');
    expect(matter(markdown).data).toMatchObject({
      id: source.id,
      notebookId: notebook.id,
      title: 'Amber Court',
      origin: { type: 'paste' },
      conversionNotes: [],
    });

    const list = await app.inject({
      method: 'GET',
      url: `/api/notebooks/${notebook.id}/sources`,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual([source]);
    expect(list.body).not.toContain('# Court');

    const detail = await app.inject({ method: 'GET', url: `/api/sources/${source.id}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toEqual({ ...source, content: '# Court\n\nAmber rules here.' });

    const db = new Database(join(dataDir, 'worldbookllm.db'), { readonly: true });
    const columns = db.prepare('PRAGMA table_info(sources)').all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).not.toContain('content');
    db.close();
  });

  it('previews lorebook JSON and saves reviewed entries as individual sources', async () => {
    const notebook = await createNotebook();
    const lorebook = Buffer.from(
      JSON.stringify({
        entries: {
          0: { uid: 0, comment: 'Amber Court', key: ['amber'], content: 'Amber rules here.' },
          1: { uid: 1, key: ['Glass Marsh'], content: 'The marsh reflects stars.' },
        },
      }),
    );
    const previewResponse = await app.inject({
      method: 'POST',
      url: `/api/notebooks/${notebook.id}/source-previews/file`,
      ...multipartUpload('lorebook.json', lorebook, 'application/json'),
    });

    expect(previewResponse.statusCode).toBe(200);
    const preview = previewResponse.json<{
      format: string;
      origin: { type: string; fileName: string; mediaType: string };
      entries: Array<{ title: string; markdown: string }>;
      conversionNotes: string[];
    }>();
    expect(preview.format).toBe('lorebook');
    expect(preview.origin).toEqual({
      type: 'file',
      fileName: 'lorebook.json',
      mediaType: 'application/json',
    });
    expect(preview.entries).toEqual([
      { title: 'Amber Court', markdown: 'Amber rules here.' },
      { title: 'Glass Marsh', markdown: 'The marsh reflects stars.' },
    ]);

    const save = await app.inject({
      method: 'POST',
      url: `/api/notebooks/${notebook.id}/sources/batch`,
      payload: preview.entries.map((entry) => ({
        title: entry.title,
        content: entry.markdown,
        origin: preview.origin,
        conversionNotes: preview.conversionNotes,
      })),
    });
    expect(save.statusCode).toBe(201);
    const sources = save.json<Array<{ filePath: string; origin: unknown }>>();
    expect(sources).toHaveLength(2);
    expect(sources[0]?.origin).toEqual({
      type: 'file',
      fileName: 'lorebook.json',
      mediaType: 'application/json',
    });
    expect(readFileSync(join(dataDir, sources[0]?.filePath ?? ''), 'utf8')).not.toContain('"uid"');
  });

  it('previews and saves a Markdown upload with a text/markdown origin', async () => {
    const notebook = await createNotebook();
    const previewResponse = await app.inject({
      method: 'POST',
      url: `/api/notebooks/${notebook.id}/source-previews/file`,
      ...multipartUpload('glass-marsh.md', fixture('sample.md'), 'text/markdown'),
    });
    expect(previewResponse.statusCode).toBe(200);
    const preview = previewResponse.json<{
      format: string;
      origin: { type: string; fileName: string; mediaType: string };
      entries: Array<{ title: string; markdown: string }>;
      conversionNotes: string[];
    }>();
    expect(preview.format).toBe('markdown');
    expect(preview.origin.mediaType).toBe('text/markdown');
    expect(preview.entries[0]?.title).toBe('Glass Marsh');

    const save = await app.inject({
      method: 'POST',
      url: `/api/notebooks/${notebook.id}/sources/batch`,
      payload: [
        {
          title: preview.entries[0]?.title,
          content: preview.entries[0]?.markdown,
          origin: preview.origin,
          conversionNotes: preview.conversionNotes,
        },
      ],
    });
    expect(save.statusCode).toBe(201);
    const sources = save.json<Array<{ filePath: string; origin: { mediaType: string } }>>();
    expect(sources[0]?.origin.mediaType).toBe('text/markdown');
    const stored = matter(readFileSync(join(dataDir, sources[0]?.filePath ?? ''), 'utf8'));
    expect(stored.content).toContain('The marsh swallows every road');
  });

  it('previews a PDF upload into best-effort Markdown', async () => {
    const notebook = await createNotebook();
    const previewResponse = await app.inject({
      method: 'POST',
      url: `/api/notebooks/${notebook.id}/source-previews/file`,
      ...multipartUpload('setting-bible.pdf', fixture('sample.pdf'), 'application/pdf'),
    });
    expect(previewResponse.statusCode).toBe(200);
    const preview = previewResponse.json<{
      format: string;
      origin: { mediaType: string };
      entries: Array<{ markdown: string }>;
      conversionNotes: string[];
    }>();
    expect(preview.format).toBe('pdf');
    expect(preview.origin.mediaType).toBe('application/pdf');
    expect(preview.entries[0]?.markdown).toContain('Glass Marsh Setting Bible');
    expect(preview.conversionNotes[0]).toMatch(/PDF/u);
  });

  it('accepts unfamiliar JSON as a best-effort generic import', async () => {
    const notebook = await createNotebook();
    const response = await app.inject({
      method: 'POST',
      url: `/api/notebooks/${notebook.id}/source-previews/file`,
      ...multipartUpload(
        'other.json',
        Buffer.from('{"hello":"world of the drowned fen and its wardens"}'),
      ),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ format: string }>().format).toBe('json');
  });

  it('rejects unreadable uploads and an over-long file name without creating sources', async () => {
    const notebook = await createNotebook();

    const malformed = await app.inject({
      method: 'POST',
      url: `/api/notebooks/${notebook.id}/source-previews/file`,
      ...multipartUpload('atlas.json', Buffer.from('{"entries": [ broken'), 'application/json'),
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toMatchObject({ error: 'invalid_import' });

    const binary = await app.inject({
      method: 'POST',
      url: `/api/notebooks/${notebook.id}/source-previews/file`,
      ...multipartUpload('mystery.bin', fixture('binary.bin')),
    });
    expect(binary.statusCode).toBe(400);
    expect(binary.json()).toMatchObject({ error: 'invalid_import' });

    const longName = `${'a'.repeat(255)}.md`;
    const longNameResponse = await app.inject({
      method: 'POST',
      url: `/api/notebooks/${notebook.id}/source-previews/file`,
      ...multipartUpload(longName, Buffer.from('# Long name')),
    });
    expect(longNameResponse.statusCode).toBe(400);
    expect(longNameResponse.json()).toMatchObject({ error: 'invalid_import' });

    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/notebooks/${notebook.id}/sources`,
        })
      ).json(),
    ).toEqual([]);
  });

  it('searches a notebook full-text with ranked, excerpted results', async () => {
    const notebook = await createNotebook();
    const other = await createNotebook('Other');
    await app.inject({
      method: 'POST',
      url: `/api/notebooks/${notebook.id}/sources/batch`,
      payload: [
        { title: 'Iron Compact charter', content: 'The founding charter.' },
        { title: 'Harbor gossip', content: 'The Iron Compact controls the eastern quays.' },
        { title: 'Weather', content: 'It rains in the marsh.' },
      ],
    });

    const search = await app.inject({
      method: 'GET',
      url: `/api/notebooks/${notebook.id}/sources/search?q=iron%20compact`,
    });
    expect(search.statusCode).toBe(200);
    const results = search.json<Array<{ title: string; excerpt: string; category: null }>>();
    expect(results.map((result) => result.title)).toEqual([
      'Iron Compact charter',
      'Harbor gossip',
    ]);
    expect(results[1]?.excerpt).toContain('Iron Compact');

    const otherNotebook = await app.inject({
      method: 'GET',
      url: `/api/notebooks/${other.id}/sources/search?q=iron`,
    });
    expect(otherNotebook.statusCode).toBe(200);
    expect(otherNotebook.json()).toEqual([]);

    const blank = await app.inject({
      method: 'GET',
      url: `/api/notebooks/${notebook.id}/sources/search?q=%20%20`,
    });
    expect(blank.statusCode).toBe(400);
    expect(blank.json()).toMatchObject({ error: 'validation_error' });

    const missingParam = await app.inject({
      method: 'GET',
      url: `/api/notebooks/${notebook.id}/sources/search`,
    });
    expect(missingParam.statusCode).toBe(400);

    const missingNotebook = await app.inject({
      method: 'GET',
      url: '/api/notebooks/f9942d0a-eaca-41a8-a3d8-87987cc173fd/sources/search?q=iron',
    });
    expect(missingNotebook.statusCode).toBe(404);
  });

  it('reconciles source title, body metadata, and timestamp after external edits', async () => {
    const notebook = await createNotebook();
    const create = await app.inject({
      method: 'POST',
      url: `/api/notebooks/${notebook.id}/sources`,
      payload: { title: 'Old title', content: 'old body' },
    });
    const source = create.json<{ id: string; filePath: string }>();
    const absolutePath = join(dataDir, source.filePath);
    const parsed = matter(readFileSync(absolutePath, 'utf8'));
    parsed.data.title = 'External title';
    parsed.data.updatedAt = '2026-07-10T18:00:00.000Z';
    const edited = matter
      .stringify('five newly edited body words', parsed.data)
      .replace(/\n$/u, '');
    writeFileSync(absolutePath, edited, { mode: 0o600 });

    const detail = await app.inject({ method: 'GET', url: `/api/sources/${source.id}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      title: 'External title',
      content: 'five newly edited body words',
      wordCount: 5,
      updatedAt: '2026-07-10T18:00:00.000Z',
    });

    const db = new Database(join(dataDir, 'worldbookllm.db'), { readonly: true });
    expect(
      db.prepare('SELECT title, word_count, updated_at FROM sources WHERE id = ?').get(source.id),
    ).toEqual({
      title: 'External title',
      word_count: 5,
      updated_at: '2026-07-10T18:00:00.000Z',
    });
    db.close();
  });

  it('reads sources whose frontmatter serializes origin keys in a different order', async () => {
    const notebook = await createNotebook();
    const create = await app.inject({
      method: 'POST',
      url: `/api/notebooks/${notebook.id}/sources`,
      payload: {
        title: 'Reordered origin',
        content: 'entry body',
        origin: { type: 'file', fileName: 'lorebook.json', mediaType: 'application/json' },
      },
    });
    const source = create.json<{ id: string; filePath: string }>();
    const absolutePath = join(dataDir, source.filePath);
    const parsed = matter(readFileSync(absolutePath, 'utf8'));
    const origin = parsed.data.origin as { type: string; fileName: string; mediaType: string };
    parsed.data.origin = {
      mediaType: origin.mediaType,
      fileName: origin.fileName,
      type: origin.type,
    };
    writeFileSync(absolutePath, matter.stringify('entry body', parsed.data).replace(/\n$/u, ''), {
      mode: 0o600,
    });

    const detail = await app.inject({ method: 'GET', url: `/api/sources/${source.id}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      origin: { type: 'file', fileName: 'lorebook.json', mediaType: 'application/json' },
    });
  });

  it('treats invalid stored source metadata as an internal error, not bad client input', async () => {
    const notebook = await createNotebook();
    await app.inject({
      method: 'POST',
      url: `/api/notebooks/${notebook.id}/sources`,
      payload: { title: 'Valid title', content: 'body' },
    });
    const db = new Database(join(dataDir, 'worldbookllm.db'));
    db.prepare('UPDATE sources SET title = ?').run('');
    db.close();

    const response = await app.inject({
      method: 'GET',
      url: `/api/notebooks/${notebook.id}/sources`,
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: 'internal_error',
      message: 'Internal server error',
    });
  });

  it('deletes source files and cascades notebook state', async () => {
    const notebook = await createNotebook();
    const first = await app.inject({
      method: 'POST',
      url: `/api/notebooks/${notebook.id}/sources`,
      payload: { title: 'First', content: 'first body' },
    });
    const source = first.json<{ id: string; filePath: string }>();
    const absolutePath = join(dataDir, source.filePath);

    const deleteSource = await app.inject({ method: 'DELETE', url: `/api/sources/${source.id}` });
    expect(deleteSource.statusCode).toBe(204);
    expect(existsSync(absolutePath)).toBe(false);

    await app.inject({
      method: 'POST',
      url: `/api/notebooks/${notebook.id}/sources`,
      payload: { title: 'Second', content: 'second body' },
    });
    const notebookDirectory = join(dataDir, 'notebooks', notebook.id);
    const deleteNotebook = await app.inject({
      method: 'DELETE',
      url: `/api/notebooks/${notebook.id}`,
    });
    expect(deleteNotebook.statusCode).toBe(204);
    expect(existsSync(notebookDirectory)).toBe(false);

    const db = new Database(join(dataDir, 'worldbookllm.db'), { readonly: true });
    expect(db.prepare('SELECT count(*) FROM sources').pluck().get()).toBe(0);
    expect(db.prepare('SELECT count(*) FROM notebooks').pluck().get()).toBe(0);
    db.close();
  });

  it('manages multiple secrets without returning raw values', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/api/secrets',
      payload: { key: 'api_key_nanogpt', value: 'first-secret-value', label: 'First' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/secrets',
      payload: { key: 'api_key_nanogpt', value: 'second-secret-value', label: 'Second' },
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    const firstEntry = first.json<{ id: string }>();
    const secondEntry = second.json<{ id: string }>();
    expect(first.body).not.toContain('first-secret-value');
    expect(second.body).not.toContain('second-secret-value');

    const activate = await app.inject({
      method: 'POST',
      url: `/api/secrets/api_key_nanogpt/${firstEntry.id}/activate`,
    });
    expect(activate.statusCode).toBe(204);

    const state = await app.inject({ method: 'GET', url: '/api/secrets' });
    expect(state.statusCode).toBe(200);
    expect(state.body).not.toContain('secret-value');
    expect(state.json()).toEqual({
      api_key_nanogpt: [
        expect.objectContaining({ id: firstEntry.id, active: true }),
        expect.objectContaining({ id: secondEntry.id, active: false }),
      ],
    });

    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/secrets/api_key_nanogpt/${firstEntry.id}`,
    });
    expect(remove.statusCode).toBe(204);
    const fallback = await app.inject({ method: 'GET', url: '/api/secrets' });
    expect(fallback.json()).toEqual({
      api_key_nanogpt: [expect.objectContaining({ id: secondEntry.id, active: true })],
    });
  });

  it('exposes provider catalog and static model routes without secret values', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/secrets',
      payload: { key: 'api_key_nanogpt', value: 'provider-route-secret', label: 'Primary' },
    });
    const catalog = await app.inject({ method: 'GET', url: '/api/providers' });
    expect(catalog.statusCode).toBe(200);
    expect(catalog.body).not.toContain('provider-route-secret');
    expect(catalog.json<Array<{ source: string; hasSecret: boolean }>>()).toEqual(
      expect.arrayContaining([expect.objectContaining({ source: 'nanogpt', hasSecret: true })]),
    );

    const models = await app.inject({
      method: 'POST',
      url: '/api/providers/models',
      payload: { source: 'claude' },
    });
    expect(models.statusCode).toBe(200);
    expect(models.json<{ models: unknown[] }>().models.length).toBeGreaterThan(0);
  });

  it('returns a configuration error when a provider key is missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/providers/models',
      payload: { source: 'nanogpt' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: 'configuration_error',
      message: 'NanoGPT requires an API key.',
    });
  });

  it('creates, lists, patches, reads, and deletes chats', async () => {
    const notebook = await createNotebook();
    const create = await app.inject({
      method: 'POST',
      url: `/api/notebooks/${notebook.id}/chats`,
      payload: {},
    });
    expect(create.statusCode).toBe(201);
    const chat = create.json<{ id: string }>();
    expect(create.json()).toMatchObject({
      notebookId: notebook.id,
      title: 'New chat',
      sourceIds: [],
      providerOverride: null,
    });
    const list = await app.inject({ method: 'GET', url: `/api/notebooks/${notebook.id}/chats` });
    expect(list.json()).toEqual([create.json()]);
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/chats/${chat.id}`,
      payload: { title: 'Revised', providerOverride: { source: 'nanogpt', model: 'model' } },
    });
    expect(patch.json()).toMatchObject({
      title: 'Revised',
      providerOverride: { source: 'nanogpt', model: 'model' },
    });
    const detail = await app.inject({ method: 'GET', url: `/api/chats/${chat.id}` });
    expect(detail.json()).toMatchObject({ id: chat.id, messages: [] });
    expect((await app.inject({ method: 'DELETE', url: `/api/chats/${chat.id}` })).statusCode).toBe(
      204,
    );
  });

  it('streams normalized chat events and persists the assistant', async () => {
    await app.close();
    app = buildApp({
      dataDir,
      logger: false,
      fetchImpl: async () =>
        Promise.resolve(
          new Response('data: {"choices":[{"delta":{"content":"Amber"}}]}\n\ndata: [DONE]\n\n'),
        ),
    });
    const notebookResponse = await app.inject({
      method: 'POST',
      url: '/api/notebooks',
      payload: {
        name: 'Atlas',
        settings: { source: 'custom', model: 'local', baseUrl: 'http://provider.test/v1' },
      },
    });
    const notebook = notebookResponse.json<{ id: string }>();
    const chatResponse = await app.inject({
      method: 'POST',
      url: `/api/notebooks/${notebook.id}/chats`,
      payload: {},
    });
    const chat = chatResponse.json<{ id: string }>();
    const stream = await app.inject({
      method: 'POST',
      url: `/api/chats/${chat.id}/messages`,
      payload: { content: 'Question' },
    });
    expect(stream.statusCode).toBe(200);
    expect(stream.headers['content-type']).toContain('text/event-stream');
    expect(stream.body).toContain('event: delta');
    expect(stream.body).toContain('event: done');
    const detail = await app.inject({ method: 'GET', url: `/api/chats/${chat.id}` });
    expect(
      detail.json<{ messages: Array<{ role: string; content: string; status: string }> }>()
        .messages,
    ).toEqual([
      expect.objectContaining({ role: 'user', content: 'Question', status: 'complete' }),
      expect.objectContaining({ role: 'assistant', content: 'Amber', status: 'complete' }),
    ]);
  });

  it('propagates a disconnected message stream and persists interruption', async () => {
    await app.close();
    let markUpstreamAborted!: () => void;
    const upstreamAborted = new Promise<void>((resolve) => {
      markUpstreamAborted = resolve;
    });
    app = buildApp({
      dataDir,
      logger: false,
      fetchImpl: async (_input, init) =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(
                  new TextEncoder().encode(
                    'data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n',
                  ),
                );
                init?.signal?.addEventListener(
                  'abort',
                  () => {
                    markUpstreamAborted();
                    controller.error(new Error('aborted'));
                  },
                  { once: true },
                );
              },
            }),
          ),
        ),
    });
    const notebook = (
      await app.inject({
        method: 'POST',
        url: '/api/notebooks',
        payload: {
          name: 'Abort',
          settings: { source: 'custom', model: 'local', baseUrl: 'http://provider.test/v1' },
        },
      })
    ).json<{ id: string }>();
    const chat = (
      await app.inject({ method: 'POST', url: `/api/notebooks/${notebook.id}/chats`, payload: {} })
    ).json<{ id: string }>();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP address');
    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/chats/${chat.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'Question' }),
      signal: controller.signal,
    });
    await response.body?.getReader().read();
    controller.abort();
    await upstreamAborted;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const detail = await app.inject({ method: 'GET', url: `/api/chats/${chat.id}` });
    expect(
      detail.json<{ messages: Array<{ content: string; status: string }> }>().messages.at(-1),
    ).toMatchObject({
      content: 'Partial',
      status: 'interrupted',
    });
  });

  it('reopens one data directory without losing persisted state', async () => {
    const notebook = await createNotebook('Persistent');
    await app.close();
    app = buildApp({ dataDir, logger: false });

    const response = await app.inject({
      method: 'GET',
      url: `/api/notebooks/${notebook.id}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: notebook.id, name: 'Persistent' });

    const db = new Database(join(dataDir, 'worldbookllm.db'), { readonly: true });
    expect(db.pragma('user_version', { simple: true })).toBe(6);
    db.close();
  });
});
