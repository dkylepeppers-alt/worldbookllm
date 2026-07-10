import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Chat, Message } from '@worldbookllm/shared';
import matter from 'gray-matter';
import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../db/database.js';
import { SourceFileStore } from '../files/source-files.js';
import { NotebookService } from './notebooks.js';
import { PromptAssembler } from './prompt-assembler.js';
import { SourceService } from './sources.js';

const tempDirs: string[] = [];

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), 'worldbookllm-prompt-'));
  tempDirs.push(dataDir);
  const db = openDatabase(dataDir);
  const files = new SourceFileStore(dataDir);
  const notebooks = new NotebookService(db, files);
  const sources = new SourceService(db, files);
  const notebook = notebooks.create({ name: 'Atlas', settings: null });
  return { dataDir, db, sources, notebook, assembler: new PromptAssembler(sources) };
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function message(overrides: Partial<Message>): Message {
  return {
    id: crypto.randomUUID(),
    chatId: '62455a02-2fe1-4b6d-a6ce-4517bf06ada7',
    seq: 0,
    role: 'user',
    content: 'history',
    reasoning: null,
    status: 'complete',
    context: null,
    createdAt: '2026-07-10T12:00:00.000Z',
    ...overrides,
  };
}

describe('PromptAssembler', () => {
  it('reads fresh sources in selected order and escapes title attributes', () => {
    const { dataDir, db, sources, notebook, assembler } = setup();
    const first = sources.create(notebook.id, { title: 'First', content: 'old first' });
    const second = sources.create(notebook.id, {
      title: 'Second & "quoted" <lore>',
      content: 'second body',
    });
    const firstPath = join(dataDir, first.filePath);
    const parsed = matter(readFileSync(firstPath, 'utf8'));
    const edited = matter.stringify('fresh first', parsed.data).replace(/\n$/u, '');
    writeFileSync(firstPath, edited, { mode: 0o600 });
    const chat: Chat = {
      id: '62455a02-2fe1-4b6d-a6ce-4517bf06ada7',
      notebookId: notebook.id,
      title: 'Chat',
      sourceIds: [second.id, first.id],
      providerOverride: null,
      createdAt: first.createdAt,
      updatedAt: first.updatedAt,
    };

    const content = assembler.assemble(chat, [], 'Question')[0]?.content;
    expect(content).toBeTypeOf('string');
    expect(content).toContain('title="Second &amp; &quot;quoted&quot; &lt;lore&gt;"');
    expect(content?.indexOf('second body')).toBeLessThan(content?.indexOf('fresh first') ?? -1);
    expect(content).not.toContain('old first');
    db.close();
  });

  it('includes eligible history and appends the incoming user message', () => {
    const { db, assembler, notebook } = setup();
    const chat: Chat = {
      id: '62455a02-2fe1-4b6d-a6ce-4517bf06ada7',
      notebookId: notebook.id,
      title: 'Chat',
      sourceIds: [],
      providerOverride: null,
      createdAt: '2026-07-10T12:00:00.000Z',
      updatedAt: '2026-07-10T12:00:00.000Z',
    };
    const history = [
      message({ seq: 0, role: 'user', content: 'User history' }),
      message({ seq: 1, role: 'assistant', content: 'Complete', status: 'complete' }),
      message({ seq: 2, role: 'assistant', content: 'Partial', status: 'interrupted' }),
      message({ seq: 3, role: 'assistant', content: '', status: 'interrupted' }),
      message({ seq: 4, role: 'assistant', content: 'Failed', status: 'error' }),
    ];

    expect(assembler.assemble(chat, history, 'New question').slice(1)).toEqual([
      { role: 'user', content: 'User history' },
      { role: 'assistant', content: 'Complete' },
      { role: 'assistant', content: 'Partial' },
      { role: 'user', content: 'New question' },
    ]);
    db.close();
  });

  it('states explicitly when no sources are selected', () => {
    const { db, assembler, notebook } = setup();
    const chat: Chat = {
      id: '62455a02-2fe1-4b6d-a6ce-4517bf06ada7',
      notebookId: notebook.id,
      title: 'Chat',
      sourceIds: [],
      providerOverride: null,
      createdAt: '2026-07-10T12:00:00.000Z',
      updatedAt: '2026-07-10T12:00:00.000Z',
    };
    expect(assembler.assemble(chat, [], 'Question')[0]?.content).toContain('No sources selected.');
    db.close();
  });
});
