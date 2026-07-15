import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Chat, Message, Preset, PresetModule } from '@worldbookllm/shared';
import Database from 'better-sqlite3';
import matter from 'gray-matter';
import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../db/database.js';
import { migrateToVersion1 } from '../db/migrations/001-init.js';
import { migrateToVersion2 } from '../db/migrations/002-source-provenance.js';
import { SourceFileStore } from '../files/source-files.js';
import { NotebookService } from './notebooks.js';
import { PresetService } from './presets.js';
import { PromptAssembler } from './prompt-assembler.js';
import { SourceService } from './sources.js';

const tempDirs: string[] = [];
const CHAT_ID = '62455a02-2fe1-4b6d-a6ce-4517bf06ada7';
const NOW = '2026-07-10T12:00:00.000Z';

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), 'worldbookllm-prompt-'));
  tempDirs.push(dataDir);
  const db = openDatabase(dataDir);
  const files = new SourceFileStore(dataDir);
  const notebooks = new NotebookService(db, files);
  const sources = new SourceService(db, files);
  const notebook = notebooks.create({ name: 'Atlas', settings: null });
  const chat: Chat = {
    id: CHAT_ID,
    notebookId: notebook.id,
    title: 'Chat',
    sourceIds: [],
    providerOverride: null,
    presetId: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
  return { dataDir, db, sources, notebook, chat, assembler: new PromptAssembler(sources) };
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function message(overrides: Partial<Message>): Message {
  return {
    id: crypto.randomUUID(),
    chatId: CHAT_ID,
    seq: 0,
    role: 'user',
    content: 'history',
    reasoning: null,
    status: 'complete',
    context: null,
    createdAt: NOW,
    ...overrides,
  };
}

function custom(
  key: string,
  content: string,
  insertion: PresetModule['insertion'],
  role: 'system' | 'user' | 'assistant' = 'system',
  enabled = true,
): PresetModule {
  return { key, name: key, kind: 'custom', role, content, enabled, insertion };
}

function sourcesModule(insertion: PresetModule['insertion']): PresetModule {
  return {
    key: 'sources',
    name: 'Sources',
    kind: 'sources',
    role: 'system',
    content: null,
    enabled: true,
    insertion,
  };
}

function preset(modules: PresetModule[]): Preset {
  return {
    id: '786f38a3-6ee4-493f-a6af-7a28e53c9a29',
    schemaVersion: 1,
    name: 'Test preset',
    generation: { temperature: 0.7, topP: null, maxTokens: null, assistantPrefill: null },
    modules,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe('PromptAssembler', () => {
  it.each([
    ['clean migration', false, false],
    ['v2 upgrade', true, true],
  ] as const)(
    'keeps the seeded preset exactly compatible with the pre-M4 prompt after a %s',
    (_label, startAtV2, selectSource) => {
      const dataDir = mkdtempSync(join(tmpdir(), 'worldbookllm-seeded-prompt-'));
      tempDirs.push(dataDir);
      if (startAtV2) {
        const legacy = new Database(join(dataDir, 'worldbookllm.db'));
        legacy.pragma('foreign_keys = ON');
        migrateToVersion1(legacy);
        migrateToVersion2(legacy);
        legacy.pragma('user_version = 2');
        legacy.close();
      }

      const db = openDatabase(dataDir);
      const files = new SourceFileStore(dataDir);
      const notebooks = new NotebookService(db, files);
      const sources = new SourceService(db, files);
      const notebook = notebooks.create({ name: 'Atlas', settings: null });
      const source = selectSource
        ? sources.create(notebook.id, {
            title: 'Second & "quoted" <lore>',
            content: 'Source body',
          })
        : undefined;
      const chat: Chat = {
        id: CHAT_ID,
        notebookId: notebook.id,
        title: 'Chat',
        sourceIds: source === undefined ? [] : [source.id],
        providerOverride: null,
        presetId: null,
        createdAt: NOW,
        updatedAt: NOW,
      };
      const presets = new PresetService(db);
      const seeded = presets.resolve(null);
      const sourceSection =
        source === undefined
          ? 'No sources selected.'
          : `<source id="${source.id}" title="Second &amp; &quot;quoted&quot; &lt;lore&gt;">\nSource body\n</source>`;

      expect(
        new PromptAssembler(sources).assemble(
          chat,
          [message({ role: 'user', content: 'Earlier' })],
          'Newest',
          seeded,
        ).messages,
      ).toEqual([
        {
          role: 'system',
          content: `You are a creative writing and worldbuilding assistant working from user-provided source material.\n\n## Sources\n${sourceSection}\n\n## Grounding instructions\nTreat the supplied sources as the grounding for your answer. Preserve established facts and clearly distinguish reasonable development from facts stated in the sources. If the sources do not answer something, say so rather than inventing certainty.`,
        },
        { role: 'user', content: 'Earlier' },
        { role: 'user', content: 'Newest' },
      ]);
      db.close();
    },
  );

  it('reads fresh sources in selected order and returns exact snapshots with fresh hashes', () => {
    const { dataDir, db, sources, notebook, chat, assembler } = setup();
    const first = sources.create(notebook.id, { title: 'First', content: 'old first' });
    const second = sources.create(notebook.id, {
      title: 'Second & "quoted" <lore>',
      content: 'second body',
    });
    const firstPath = join(dataDir, first.filePath);
    const parsed = matter(readFileSync(firstPath, 'utf8'));
    writeFileSync(firstPath, matter.stringify('fresh first', parsed.data).replace(/\n$/u, ''), {
      mode: 0o600,
    });
    chat.sourceIds = [second.id, first.id];

    const result = assembler.assemble(
      chat,
      [],
      'Question',
      preset([sourcesModule({ position: 'before_history' })]),
    );

    expect(result.messages).toEqual([
      {
        role: 'system',
        content: `## Sources\n<source id="${second.id}" title="Second &amp; &quot;quoted&quot; &lt;lore&gt;">\nsecond body\n</source>\n\n<source id="${first.id}" title="First">\nfresh first\n</source>`,
      },
      { role: 'user', content: 'Question' },
    ]);
    expect(result.sources).toEqual([
      {
        id: second.id,
        title: second.title,
        contentHash: second.contentHash,
        content: 'second body',
      },
      {
        id: first.id,
        title: first.title,
        contentHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        content: 'fresh first',
      },
    ]);
    expect(result.sources[1]?.contentHash).not.toBe(first.contentHash);
    db.close();
  });

  it('emits exact empty-source text and keeps the newest user message last', () => {
    const { db, assembler, chat } = setup();
    const result = assembler.assemble(
      chat,
      [message({ role: 'user', content: 'Earlier' })],
      'Newest',
      preset([sourcesModule({ position: 'at_depth', depth: 0 })]),
    );

    expect(result).toEqual({
      messages: [
        { role: 'user', content: 'Earlier' },
        { role: 'system', content: '## Sources\nNo sources selected.' },
        { role: 'user', content: 'Newest' },
      ],
      sources: [],
    });
    db.close();
  });

  it('filters history before inserting modules at every depth boundary', () => {
    const { db, assembler, chat } = setup();
    const history = [
      message({ seq: 0, role: 'user', content: 'u0' }),
      message({ seq: 1, role: 'assistant', content: '', status: 'interrupted' }),
      message({ seq: 2, role: 'assistant', content: 'a1', status: 'complete' }),
      message({ seq: 3, role: 'assistant', content: 'partial', status: 'interrupted' }),
      message({ seq: 4, role: 'assistant', content: 'failed', status: 'error' }),
    ];
    const modules = [
      custom('before-a', 'before-a', { position: 'before_history' }),
      custom('depth-far', 'depth-far', { position: 'at_depth', depth: 99 }),
      custom('before-b', 'before-b', { position: 'before_history' }, 'assistant'),
      custom('depth-2', 'depth-2', { position: 'at_depth', depth: 2 }, 'user'),
      custom('depth-1-a', 'depth-1-a', { position: 'at_depth', depth: 1 }),
      custom('depth-1-b', 'depth-1-b', { position: 'at_depth', depth: 1 }, 'assistant'),
      custom('depth-0', 'depth-0', { position: 'at_depth', depth: 0 }),
      custom('off', 'disabled', { position: 'before_history' }, 'system', false),
      sourcesModule({ position: 'at_depth', depth: 3 }),
    ];

    expect(assembler.assemble(chat, history, 'new', preset(modules)).messages).toEqual([
      { role: 'system', content: 'before-a' },
      { role: 'assistant', content: 'before-b' },
      { role: 'system', content: 'depth-far' },
      { role: 'system', content: '## Sources\nNo sources selected.' },
      { role: 'user', content: 'u0' },
      { role: 'user', content: 'depth-2' },
      { role: 'assistant', content: 'a1' },
      { role: 'system', content: 'depth-1-a' },
      { role: 'assistant', content: 'depth-1-b' },
      { role: 'assistant', content: 'partial' },
      { role: 'system', content: 'depth-0' },
      { role: 'user', content: 'new' },
    ]);
    db.close();
  });
});
