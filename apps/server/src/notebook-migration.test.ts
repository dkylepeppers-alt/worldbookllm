import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BookCheckResult, Notebook, SourceDetail } from '@worldbookllm/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';

let app: FastifyInstance;
let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'worldbookllm-notebook-migration-'));
  app = buildApp({ dataDir, logger: false });
});

afterEach(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

async function createNotebook(name: string): Promise<Notebook> {
  const response = await app.inject({ method: 'POST', url: '/api/notebooks', payload: { name } });
  return response.json<Notebook>();
}

async function createSource(notebookId: string, payload: Record<string, unknown>) {
  const response = await app.inject({
    method: 'POST',
    url: `/api/notebooks/${notebookId}/sources`,
    payload,
  });
  expect(response.statusCode).toBe(201);
  return response.json<SourceDetail>();
}

describe('notebook migration', () => {
  it('turns each notebook into a book of research notes with their provenance', async () => {
    const harbor = await createNotebook('Harbor Lore');
    await createSource(harbor.id, {
      title: 'Tides',
      content: '# Tides\n\nThe harbor floods at the spring tide.\n',
      origin: { type: 'file', fileName: 'tides.md', mediaType: 'text/markdown' },
      category: 'places',
      tags: ['harbor', 'water'],
    });
    await createSource(harbor.id, { title: 'Bell Law', content: 'Bells ring twice at dusk.' });
    await createNotebook('Empty');

    const outcomes = await app.services.notebookMigration.migrateAll();
    outcomes.sort((left, right) => right.notebookName.localeCompare(left.notebookName));
    expect(outcomes).toEqual([
      expect.objectContaining({
        notebookName: 'Harbor Lore',
        bookSlug: 'harbor-lore',
        sourceCount: 2,
        fileCount: 2,
        error: null,
        skippedSources: [],
      }),
      expect.objectContaining({ notebookName: 'Empty', bookSlug: 'empty', sourceCount: 0 }),
    ]);

    const tides = readFileSync(join(dataDir, 'projects/harbor-lore/research/tides.md'), 'utf8');
    expect(tides).toContain('origin-type: "file"\norigin-file: "tides.md"');
    expect(tides).toContain('legacy-category: "places"\ntags:\n  - "harbor"\n  - "water"');
    expect(tides).toContain('## Findings\n\nThe harbor floods at the spring tide.');

    const validate = (
      await app.inject({ method: 'GET', url: '/api/books/harbor-lore/checks/validate' })
    ).json<BookCheckResult>();
    expect(validate.envelope.ok).toBe(true);

    // The notebook and its files are untouched.
    const notebooks = await app.inject({ method: 'GET', url: '/api/notebooks' });
    expect(notebooks.json<Notebook[]>()).toHaveLength(2);
    expect(readdirSync(join(dataDir, 'notebooks', harbor.id, 'sources'))).toHaveLength(2);
  });

  it('is idempotent', async () => {
    const notebook = await createNotebook('Once');
    await createSource(notebook.id, { title: 'Only', content: 'Text.' });
    await app.services.notebookMigration.migrateAll();
    expect(await app.services.notebookMigration.migrateAll()).toEqual([]);
    expect(readdirSync(join(dataDir, 'projects'))).toEqual(['once']);
    expect(app.services.notebookMigration.migrated().get(notebook.id)).toBe('once');
  });

  it('skips an unreadable source and reports it', async () => {
    const notebook = await createNotebook('Damaged');
    const good = await createSource(notebook.id, { title: 'Good', content: 'Fine.' });
    const bad = await createSource(notebook.id, { title: 'Bad', content: 'Soon broken.' });
    writeFileSync(join(dataDir, bad.filePath), '---\nid: [unterminated\n---\n');

    const [outcome] = await app.services.notebookMigration.migrateAll();
    expect(outcome).toMatchObject({ sourceCount: 2, fileCount: 1, error: null });
    expect(outcome?.skippedSources).toEqual([
      expect.objectContaining({ sourceId: bad.id, title: 'Bad' }),
    ]);
    expect(existsSync(join(dataDir, 'projects/damaged/research/good.md'))).toBe(true);
    expect(good.id).toBeDefined();
  });
});
