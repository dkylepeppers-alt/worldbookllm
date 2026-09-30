import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  AgentChat,
  AgentChatDetail,
  BookCheckResult,
  NotebookMigrationReport,
} from '@worldbookllm/shared';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import matter from 'gray-matter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from './app.js';
import { openDatabase } from './db/database.js';

let app: FastifyInstance | undefined;
let dataDir: string;
let db: Database.Database;

const NOW = '2026-07-10T12:00:00.000Z';

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'worldbookllm-notebook-migration-'));
  // Build the schema, then write notebook-era data as the old app left it.
  db = openDatabase(dataDir);
});

afterEach(async () => {
  if (db.open) db.close();
  await app?.close();
  app = undefined;
  rmSync(dataDir, { recursive: true, force: true });
});

let created = 0;

/** Seeds a notebook; each is created a second after the last, which sets the migration order. */
function notebook(name: string): string {
  const id = randomUUID();
  const at = new Date(Date.parse(NOW) + 1000 * created++).toISOString();
  db.prepare('INSERT INTO notebooks (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
    id,
    name,
    at,
    at,
  );
  return id;
}

function source(
  notebookId: string,
  title: string,
  content: string,
  extra: { origin?: unknown; category?: string; tags?: string[] } = {},
): { id: string; filePath: string } {
  const id = randomUUID();
  const slug = title.toLowerCase().replaceAll(' ', '-');
  const filePath = `notebooks/${notebookId}/sources/${id}-${slug}.md`;
  const origin = extra.origin ?? { type: 'paste' };
  mkdirSync(join(dataDir, 'notebooks', notebookId, 'sources'), { recursive: true });
  writeFileSync(
    join(dataDir, filePath),
    matter.stringify(content, { id, notebookId, title, origin, createdAt: NOW, updatedAt: NOW }),
  );
  db.prepare(
    `INSERT INTO sources (id, notebook_id, title, slug, file_path, origin_json, conversion_notes_json,
       category, tags_json, word_count, content_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?, 1, ?, ?, ?)`,
  ).run(
    id,
    notebookId,
    title,
    slug,
    filePath,
    JSON.stringify(origin),
    extra.category ?? null,
    JSON.stringify(extra.tags ?? []),
    'a'.repeat(64),
    NOW,
    NOW,
  );
  return { id, filePath };
}

function chat(
  notebookId: string,
  title: string,
  sourceIds: string[],
  messages: Array<{ role: 'user' | 'assistant'; content: string; context?: unknown }>,
): void {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO chats (id, notebook_id, title, source_ids_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, notebookId, title, JSON.stringify(sourceIds), NOW, NOW);
  messages.forEach((message, seq) => {
    db.prepare(
      `INSERT INTO messages (id, chat_id, seq, role, content, status, context_json, created_at)
       VALUES (?, ?, ?, ?, ?, 'complete', ?, ?)`,
    ).run(
      randomUUID(),
      id,
      seq,
      message.role,
      message.content,
      JSON.stringify(message.context ?? null),
      NOW,
    );
  });
}

/** Starts the server on the prepared data dir; the migration runs as it becomes ready. */
async function start(): Promise<FastifyInstance> {
  db.close();
  app = buildApp({ dataDir, logger: false });
  await app.ready();
  return app;
}

describe('notebook migration', () => {
  it('moves notebooks into books with their sources and chats at startup', async () => {
    const harbor = notebook('Harbor Lore');
    const tides = source(harbor, 'Tides', '# Tides\n\nThe harbor floods at the spring tide.\n', {
      origin: { type: 'file', fileName: 'tides.md', mediaType: 'text/markdown' },
      category: 'places',
      tags: ['harbor', 'water'],
    });
    source(harbor, 'Bell Law', 'Bells ring twice at dusk.');
    chat(
      harbor,
      'When does it flood?',
      [tides.id],
      [
        { role: 'user', content: 'When does the harbor flood?' },
        {
          role: 'assistant',
          content: 'At the spring tide.',
          context: { contextVersion: 2, effectiveRequestBody: { model: 'old-model' } },
        },
      ],
    );
    notebook('Empty');

    const server = await start();

    const tidesNote = readFileSync(join(dataDir, 'projects/harbor-lore/research/tides.md'), 'utf8');
    expect(tidesNote).toContain('origin-type: "file"\norigin-file: "tides.md"');
    expect(tidesNote).toContain('legacy-category: "places"\ntags:\n  - "harbor"\n  - "water"');
    expect(tidesNote).toContain('## Findings\n\nThe harbor floods at the spring tide.');
    expect(existsSync(join(dataDir, 'projects/harbor-lore/research/bell-law.md'))).toBe(true);
    expect(existsSync(join(dataDir, 'projects/empty/story.md'))).toBe(true);

    const validate = (
      await server.inject({ method: 'GET', url: '/api/books/harbor-lore/checks/validate' })
    ).json<BookCheckResult>();
    expect(validate.envelope.ok).toBe(true);

    // The chat is now an agent chat on the book, with its history intact.
    const [moved] = (
      await server.inject({ method: 'GET', url: '/api/books/harbor-lore/agent-chats' })
    ).json<AgentChat[]>();
    expect(moved?.title).toBe('When does it flood?');
    const detail = (
      await server.inject({ method: 'GET', url: `/api/agent-chats/${moved!.id}` })
    ).json<AgentChatDetail>();
    expect(detail.messages.map((message) => [message.role, message.content])).toEqual([
      ['user', 'When does the harbor flood?'],
      ['assistant', 'At the spring tide.'],
    ]);
    expect(detail.messages[0]?.note).toContain('research/tides.md');
    expect(detail.messages[1]?.steps).toEqual([
      { index: 0, requestBody: { model: 'old-model' }, text: 'At the spring tide.', toolCalls: [] },
    ]);

    // The notebook folder is kept, renamed, once everything has moved.
    expect(existsSync(join(dataDir, 'notebooks'))).toBe(false);
    expect(existsSync(join(dataDir, 'notebooks.migrated', harbor, 'sources'))).toBe(true);

    const report = (
      await server.inject({ method: 'GET', url: '/api/notebook-migration' })
    ).json<NotebookMigrationReport>();
    expect(report.seen).toBe(false);
    expect(report.archivePath).toBe('notebooks.migrated');
    expect(report.entries).toEqual([
      expect.objectContaining({
        notebookName: 'Harbor Lore',
        bookSlug: 'harbor-lore',
        sourceCount: 2,
        fileCount: 2,
        chatCount: 1,
        error: null,
      }),
      expect.objectContaining({ notebookName: 'Empty', bookSlug: 'empty', chatCount: 0 }),
    ]);
    await server.inject({ method: 'POST', url: '/api/notebook-migration/seen' });
    expect(
      (await server.inject({ method: 'GET', url: '/api/notebook-migration' })).json<{
        seen: boolean;
      }>().seen,
    ).toBe(true);
  });

  it('is idempotent across restarts', async () => {
    const once = notebook('Once');
    source(once, 'Only', 'Text.');
    const server = await start();
    expect(await server.services.notebookMigration.migrateAll()).toEqual([]);
    expect(server.services.notebookMigration.migrated().get(once)).toBe('once');

    await server.close();
    app = buildApp({ dataDir, logger: false });
    await app.ready();
    const books = (await app.inject({ method: 'GET', url: '/api/books' })).json<unknown[]>();
    expect(books).toHaveLength(1);
  });

  it('skips an unreadable source and reports it', async () => {
    const damaged = notebook('Damaged');
    source(damaged, 'Good', 'Fine.');
    const bad = source(damaged, 'Bad', 'Soon broken.');
    writeFileSync(join(dataDir, bad.filePath), '---\nid: [unterminated\n---\n');
    db.close();
    app = buildApp({ dataDir, logger: false });

    const [outcome] = await app.services.notebookMigration.migrateAll();
    expect(outcome).toMatchObject({ sourceCount: 2, fileCount: 1, error: null });
    expect(outcome?.skippedSources).toEqual([
      expect.objectContaining({ sourceId: bad.id, title: 'Bad' }),
    ]);
    expect(existsSync(join(dataDir, 'projects/damaged/research/good.md'))).toBe(true);
  });

  it('does nothing in a data directory that never had notebooks', async () => {
    const server = await start();
    expect((await server.inject({ method: 'GET', url: '/api/notebook-migration' })).json()).toEqual(
      { entries: [], archivePath: null, seen: false },
    );
    expect(existsSync(join(dataDir, 'notebooks.migrated'))).toBe(false);
  });

  it('keeps frontmatter the notebook app did not write in the research note', async () => {
    const lore = notebook('Lore');
    const kept = source(lore, 'Kept', 'Body text.');
    const file = join(dataDir, kept.filePath);
    const parsed = matter(readFileSync(file, 'utf8'));
    writeFileSync(file, matter.stringify(parsed.content, { ...parsed.data, era: 'Second Age' }));
    await start();

    const note = readFileSync(join(dataDir, 'projects/lore/research/kept.md'), 'utf8');
    expect(note).toContain('## Original frontmatter');
    expect(note).toContain('era: Second Age');
  });

  it('retries a failed import in the same book at the next start and reports it again', async () => {
    const retry = notebook('Retry');
    source(retry, 'Note', 'Text.');
    chat(retry, 'Question', [], [{ role: 'user', content: 'Hello?' }]);
    db.close();
    app = buildApp({ dataDir, logger: false });
    const { books, notebookMigration, settings } = app.services;
    vi.spyOn(books, 'writeImports').mockRejectedValueOnce(new Error('disk full'));

    const [failed] = await notebookMigration.run();
    expect(failed).toMatchObject({ bookSlug: 'retry', error: 'disk full', chatCount: 0 });
    expect(existsSync(join(dataDir, 'notebooks'))).toBe(true);
    expect(notebookMigration.report()).toMatchObject({
      entries: [{ bookSlug: 'retry', error: 'disk full' }],
      archivePath: null,
    });
    settings.markNotebookMigrationSeen();

    const [moved] = await notebookMigration.run();
    expect(moved).toMatchObject({ bookSlug: 'retry', error: null, fileCount: 1, chatCount: 1 });
    expect(books.list().map((book) => book.slug)).toEqual(['retry']);
    expect(existsSync(join(dataDir, 'projects/retry/research/note.md'))).toBe(true);
    // The change is reported again even though the first report was dismissed.
    expect(notebookMigration.report()).toMatchObject({
      entries: [{ bookSlug: 'retry', error: null, chatCount: 1 }],
      archivePath: 'notebooks.migrated',
      seen: false,
    });
  });

  it('resumes an interrupted move without duplicating the book, notes, or chats', async () => {
    const resume = notebook('Resume');
    source(resume, 'Only', 'Text.');
    chat(resume, 'First', [], [{ role: 'user', content: 'One' }]);
    chat(resume, 'Second', [], [{ role: 'user', content: 'Two' }]);
    db.close();
    app = buildApp({ dataDir, logger: false });
    const { agent, books, notebookMigration } = app.services;
    // The second chat fails after the first was imported, as a crash would.
    const importChat = agent.importLegacyChat.bind(agent);
    vi.spyOn(agent, 'importLegacyChat')
      .mockImplementationOnce(importChat)
      .mockImplementationOnce(() => {
        throw new Error('crashed');
      });
    const [interrupted] = await notebookMigration.run();
    expect(interrupted).toMatchObject({ bookSlug: 'resume', error: 'crashed' });
    expect(notebookMigration.report().entries).toEqual([
      expect.objectContaining({ bookSlug: 'resume', error: 'crashed', chatCount: 0 }),
    ]);

    const [moved] = await notebookMigration.run();
    expect(moved).toMatchObject({ bookSlug: 'resume', error: null, fileCount: 1, chatCount: 2 });
    expect(books.list().map((book) => book.slug)).toEqual(['resume']);
    expect(books.tree('resume').files.map((file) => file.path)).not.toContain('research/only-2.md');
    expect(
      agent
        .listChats('resume')
        .map((item) => item.title)
        .sort(),
    ).toEqual(['First', 'Second']);
  });

  it('archives beside an existing notebooks.migrated folder and reports where', async () => {
    mkdirSync(join(dataDir, 'notebooks.migrated'));
    source(notebook('Late'), 'Note', 'Text.');
    await start();
    const { archivePath } = app!.services.notebookMigration.report();
    expect(archivePath).toMatch(/^notebooks\.migrated-\d{4}-\d{2}-\d{2}T/u);
    expect(existsSync(join(dataDir, archivePath!))).toBe(true);
  });
});
