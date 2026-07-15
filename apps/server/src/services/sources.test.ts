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
      title: 'Other chat',
      sourceIds: [],
      providerOverride: null,
      presetId: null,
    });
    const otherExchange = chats.beginExchange(otherChat.id, 'Other question', context);
    const crossChat = chats.create(otherNotebook.id, {
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
