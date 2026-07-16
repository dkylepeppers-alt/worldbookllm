import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { openDatabase } from '../db/database.js';
import { NotFoundError } from '../errors.js';
import { SourceFileStore } from '../files/source-files.js';
import { ChatService } from './chats.js';
import { NotebookService } from './notebooks.js';
import { SourceService } from './sources.js';

const tempDirs: string[] = [];
const context = {
  sourceIds: [],
  provider: 'nanogpt' as const,
  model: 'gpt-4o-mini',
  strictness: 'grounded' as const,
};

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), 'worldbookllm-sources-'));
  tempDirs.push(dataDir);
  const db = openDatabase(dataDir);
  const files = new SourceFileStore(dataDir);
  const notebooks = new NotebookService(db, files);
  const chats = new ChatService(db);
  const sources = new SourceService(db, files);
  const notebook = notebooks.create({ name: 'Atlas', settings: null });
  const otherNotebook = notebooks.create({ name: 'Other', settings: null });
  const chat = chats.create(notebook.id, {
    skillIds: [],
    title: 'Chat',
    sourceIds: [],
    providerOverride: null,
    presetId: null,
  });
  const exchange = chats.beginExchange(chat.id, 'Question', context);
  return { dataDir, db, notebooks, chats, sources, notebook, otherNotebook, chat, exchange };
}

function sourceFiles(dataDir: string, notebookId: string): string[] {
  const directory = join(dataDir, 'notebooks', notebookId, 'sources');
  return existsSync(directory) ? readdirSync(directory, { recursive: true }) : [];
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('SourceService assistant-response provenance', () => {
  it.each(['complete', 'interrupted', 'error'] as const)(
    'accepts a real %s assistant response and does not revalidate it on read',
    (status) => {
      const { db, chats, sources, notebook, chat, exchange } = setup();
      chats.updateAssistant(exchange.assistant.id, { content: 'Answer', reasoning: null, status });
      const origin = {
        type: 'assistant-response' as const,
        chatId: chat.id,
        messageId: exchange.assistant.id,
      };
      const created = sources.create(notebook.id, { title: 'Captured', content: 'Answer', origin });
      chats.delete(chat.id);

      expect(sources.get(created.id).origin).toEqual(origin);
      db.close();
    },
  );

  it('rejects every invalid assistant-response relationship before creating data', () => {
    const { dataDir, db, chats, sources, notebook, otherNotebook, chat, exchange } = setup();
    const otherChat = chats.create(notebook.id, {
      skillIds: [],
      title: 'Other chat',
      sourceIds: [],
      providerOverride: null,
      presetId: null,
    });
    const otherExchange = chats.beginExchange(otherChat.id, 'Other question', context);
    const crossChat = chats.create(otherNotebook.id, {
      skillIds: [],
      title: 'Cross notebook',
      sourceIds: [],
      providerOverride: null,
      presetId: null,
    });
    const crossExchange = chats.beginExchange(crossChat.id, 'Cross question', context);
    const missingChat = crypto.randomUUID();
    const missingMessage = crypto.randomUUID();
    const invalidOrigins = [
      { type: 'assistant-response' as const, chatId: missingChat, messageId: missingMessage },
      { type: 'assistant-response' as const, chatId: chat.id, messageId: missingMessage },
      { type: 'assistant-response' as const, chatId: chat.id, messageId: exchange.user.id },
      {
        type: 'assistant-response' as const,
        chatId: chat.id,
        messageId: otherExchange.assistant.id,
      },
      {
        type: 'assistant-response' as const,
        chatId: crossChat.id,
        messageId: crossExchange.assistant.id,
      },
    ];

    for (const origin of invalidOrigins) {
      expect(() =>
        sources.create(notebook.id, { title: 'Invalid', content: 'No file', origin }),
      ).toThrow(NotFoundError);
    }
    expect(sources.list(notebook.id)).toEqual([]);
    expect(sourceFiles(dataDir, notebook.id)).toEqual([]);
    db.close();
  });

  it.each(['', '   \n\t'])(
    'rejects an assistant-response origin whose message content is %j before creating data',
    (content) => {
      const { dataDir, db, chats, sources, notebook, chat, exchange } = setup();
      chats.updateAssistant(exchange.assistant.id, {
        content,
        reasoning: null,
        status: 'complete',
      });

      expect(() =>
        sources.create(notebook.id, {
          title: 'Invalid empty response',
          content: 'No file',
          origin: {
            type: 'assistant-response',
            chatId: chat.id,
            messageId: exchange.assistant.id,
          },
        }),
      ).toThrow(NotFoundError);
      expect(sources.list(notebook.id)).toEqual([]);
      expect(sourceFiles(dataDir, notebook.id)).toEqual([]);
      db.close();
    },
  );

  it('rolls back a batch and removes files when any provenance claim is invalid', () => {
    const { dataDir, db, sources, notebook, chat, exchange } = setup();
    expect(() =>
      sources.createMany(notebook.id, [
        {
          title: 'Valid first',
          content: 'Answer',
          origin: {
            type: 'assistant-response',
            chatId: chat.id,
            messageId: exchange.assistant.id,
          },
          conversionNotes: [],
        },
        {
          title: 'Invalid second',
          content: 'No answer',
          origin: {
            type: 'assistant-response',
            chatId: chat.id,
            messageId: crypto.randomUUID(),
          },
          conversionNotes: [],
        },
      ]),
    ).toThrow(NotFoundError);
    expect(sources.list(notebook.id)).toEqual([]);
    expect(sourceFiles(dataDir, notebook.id)).toEqual([]);
    db.close();
  });
});

describe('SourceService.patch', () => {
  it('edits content in place, recomputing metadata and preserving identity', () => {
    const { db, dataDir, sources, notebook } = setup();
    const created = sources.create(notebook.id, { title: 'Lore', content: 'Old body' });
    const edited = sources.patch(created.id, { content: 'A much longer new body here' });
    expect(edited).toMatchObject({
      id: created.id,
      title: 'Lore',
      slug: created.slug,
      filePath: created.filePath,
      origin: { type: 'paste' },
      createdAt: created.createdAt,
      content: 'A much longer new body here',
    });
    expect(edited.contentHash).not.toBe(created.contentHash);
    expect(edited.wordCount).toBe(6);
    expect(sourceFiles(dataDir, notebook.id)).toHaveLength(1);
    db.close();
  });

  it('renames the slugged file when the title changes and removes the old file', () => {
    const { db, dataDir, sources, notebook } = setup();
    const created = sources.create(notebook.id, { title: 'Old Title', content: 'Body' });
    const edited = sources.patch(created.id, { title: 'New Shiny Title' });
    expect(edited.title).toBe('New Shiny Title');
    expect(edited.slug).toBe('new-shiny-title');
    expect(edited.filePath).not.toBe(created.filePath);
    expect(edited.createdAt).toBe(created.createdAt);
    const files = sourceFiles(dataDir, notebook.id);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain('new-shiny-title');
    db.close();
  });

  it('throws when editing a source that does not exist', () => {
    const { db, sources } = setup();
    expect(() => sources.patch('62455a02-2fe1-4b6d-a6ce-4517bf06ada7', { title: 'X' })).toThrow(
      NotFoundError,
    );
    db.close();
  });
});
