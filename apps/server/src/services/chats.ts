import { randomUUID } from 'node:crypto';

import {
  type Chat,
  type ChatDetail,
  chatSchema,
  type CreateChat,
  type GenerationContext,
  type Message,
  messageSchema,
  type PatchChat,
} from '@worldbookllm/shared';
import type Database from 'better-sqlite3';

import type { ChatRow, MessageRow } from '../db/types.js';
import { InvalidStoredDataError, NotFoundError } from '../errors.js';

export interface AssistantUpdate {
  content: string;
  reasoning: string | null;
  status: 'complete' | 'interrupted' | 'error';
}

export interface Exchange {
  user: Message;
  assistant: Message;
}

function mapChat(row: ChatRow): Chat {
  try {
    return chatSchema.parse({
      id: row.id,
      notebookId: row.notebook_id,
      title: row.title,
      sourceIds: JSON.parse(row.source_ids_json),
      providerOverride: JSON.parse(row.provider_override_json),
      presetId: row.preset_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  } catch (error) {
    throw new InvalidStoredDataError(`Chat ${row.id} has invalid stored data`, { cause: error });
  }
}

function mapMessage(row: MessageRow): Message {
  try {
    return messageSchema.parse({
      id: row.id,
      chatId: row.chat_id,
      seq: row.seq,
      role: row.role,
      content: row.content,
      reasoning: row.reasoning,
      status: row.status,
      context: JSON.parse(row.context_json),
      createdAt: row.created_at,
    });
  } catch (error) {
    throw new InvalidStoredDataError(`Message ${row.id} has invalid stored data`, {
      cause: error,
    });
  }
}

export class ChatService {
  constructor(
    private readonly db: Database.Database,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  private requireNotebook(id: string): void {
    if (!this.db.prepare('SELECT 1 FROM notebooks WHERE id = ?').get(id)) {
      throw new NotFoundError(`Notebook ${id} was not found`);
    }
  }

  private validateSources(notebookId: string, sourceIds: string[]): void {
    if (sourceIds.length === 0) return;
    const placeholders = sourceIds.map(() => '?').join(', ');
    const rows = this.db
      .prepare(`SELECT id, notebook_id FROM sources WHERE id IN (${placeholders})`)
      .all(...sourceIds) as Array<{ id: string; notebook_id: string }>;
    if (rows.length !== sourceIds.length || rows.some((row) => row.notebook_id !== notebookId)) {
      throw new NotFoundError('One or more selected sources were not found in this notebook');
    }
  }

  private validatePreset(presetId: string | null): void {
    if (presetId === null) return;
    if (!this.db.prepare('SELECT 1 FROM presets WHERE id = ?').get(presetId)) {
      throw new NotFoundError(`Preset ${presetId} was not found`);
    }
  }

  list(notebookId: string): Chat[] {
    this.requireNotebook(notebookId);
    return (
      this.db
        .prepare('SELECT * FROM chats WHERE notebook_id = ? ORDER BY updated_at DESC, id ASC')
        .all(notebookId) as ChatRow[]
    ).map(mapChat);
  }

  get(id: string): Chat {
    const row = this.db.prepare('SELECT * FROM chats WHERE id = ?').get(id) as ChatRow | undefined;
    if (!row) throw new NotFoundError(`Chat ${id} was not found`);
    return mapChat(row);
  }

  getDetail(id: string): ChatDetail {
    return { ...this.get(id), messages: this.getHistory(id) };
  }

  create(notebookId: string, input: CreateChat): Chat {
    this.requireNotebook(notebookId);
    this.validateSources(notebookId, input.sourceIds);
    this.validatePreset(input.presetId);
    const id = randomUUID();
    const timestamp = this.now();
    this.db
      .prepare(
        'INSERT INTO chats (id, notebook_id, title, source_ids_json, provider_override_json, preset_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        notebookId,
        input.title,
        JSON.stringify(input.sourceIds),
        JSON.stringify(input.providerOverride),
        input.presetId,
        timestamp,
        timestamp,
      );
    return this.get(id);
  }

  patch(id: string, input: PatchChat): Chat {
    const current = this.get(id);
    const sourceIds = input.sourceIds ?? current.sourceIds;
    const presetId = input.presetId === undefined ? current.presetId : input.presetId;
    this.validateSources(current.notebookId, sourceIds);
    this.validatePreset(presetId);
    this.db
      .prepare(
        'UPDATE chats SET title = ?, source_ids_json = ?, provider_override_json = ?, preset_id = ?, updated_at = ? WHERE id = ?',
      )
      .run(
        input.title ?? current.title,
        JSON.stringify(sourceIds),
        JSON.stringify(
          input.providerOverride === undefined ? current.providerOverride : input.providerOverride,
        ),
        presetId,
        this.now(),
        id,
      );
    return this.get(id);
  }

  delete(id: string): void {
    const result = this.db.prepare('DELETE FROM chats WHERE id = ?').run(id);
    if (result.changes === 0) throw new NotFoundError(`Chat ${id} was not found`);
  }

  getHistory(chatId: string): Message[] {
    this.get(chatId);
    return (
      this.db
        .prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY seq ASC')
        .all(chatId) as MessageRow[]
    ).map(mapMessage);
  }

  beginExchange(chatId: string, content: string, context: GenerationContext): Exchange {
    return this.db.transaction(() => {
      const chat = this.get(chatId);
      const nextSeq = Number(
        this.db
          .prepare('SELECT COALESCE(MAX(seq), -1) + 1 FROM messages WHERE chat_id = ?')
          .pluck()
          .get(chatId),
      );
      const timestamp = this.now();
      const userId = randomUUID();
      const assistantId = randomUUID();
      const insert = this.db.prepare(
        'INSERT INTO messages (id, chat_id, seq, role, content, reasoning, status, context_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      );
      insert.run(userId, chatId, nextSeq, 'user', content, null, 'complete', 'null', timestamp);
      insert.run(
        assistantId,
        chatId,
        nextSeq + 1,
        'assistant',
        '',
        null,
        'interrupted',
        JSON.stringify(context),
        timestamp,
      );
      this.db.prepare('UPDATE chats SET updated_at = ? WHERE id = ?').run(timestamp, chatId);
      this.db
        .prepare('UPDATE notebooks SET updated_at = ? WHERE id = ?')
        .run(timestamp, chat.notebookId);
      return { user: this.getMessage(userId), assistant: this.getMessage(assistantId) };
    })();
  }

  private getMessage(id: string): Message {
    const row = this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as
      MessageRow | undefined;
    if (!row) throw new NotFoundError(`Message ${id} was not found`);
    return mapMessage(row);
  }

  updateAssistant(id: string, update: AssistantUpdate): Message {
    const result = this.db
      .prepare(
        "UPDATE messages SET content = ?, reasoning = ?, status = ? WHERE id = ? AND role = 'assistant'",
      )
      .run(update.content, update.reasoning, update.status, id);
    if (result.changes === 0) throw new NotFoundError(`Assistant message ${id} was not found`);
    return this.getMessage(id);
  }
}
