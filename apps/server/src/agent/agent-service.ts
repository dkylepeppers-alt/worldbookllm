import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';

import {
  ProviderError,
  ToolCallAccumulator,
  normalizeStreamChunk,
  parseSseStream,
  supportsTools,
  type ChatMessage,
} from '@worldbookllm/providers';
import type {
  AgentChat,
  AgentChatDetail,
  AgentMessage,
  AgentStep,
  AgentStreamEvent,
  ProviderConfig,
} from '@worldbookllm/shared';

import { ConfigurationError, ConflictError, NotFoundError } from '../errors.js';
import type { BookService } from '../services/books.js';
import type { PresetService } from '../services/presets.js';
import type { ProviderService } from '../services/providers.js';
import type { SkillService } from '../services/skills.js';
import type { CheckpointSession } from '../story/checkpoints.js';
import type { AgentToolRegistry } from './tools.js';

export const AGENT_MAX_STEPS = 24;
const TOOL_RESULT_MAX_BYTES = 24 * 1024;
const SUMMARY_MAX_CHARS = 200;

interface AgentChatRow {
  id: string;
  book: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface AgentMessageRow {
  id: string;
  chat_id: string;
  seq: number;
  role: 'user' | 'assistant';
  content: string;
  reasoning: string | null;
  status: AgentMessage['status'];
  steps_json: string;
  checkpoint_id: string | null;
  created_at: string;
  updated_at: string;
}

function toChat(row: AgentChatRow): AgentChat {
  return {
    id: row.id,
    book: row.book,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toMessage(row: AgentMessageRow): AgentMessage {
  return {
    id: row.id,
    chatId: row.chat_id,
    seq: row.seq,
    role: row.role,
    content: row.content,
    reasoning: row.reasoning,
    status: row.status,
    steps: JSON.parse(row.steps_json) as AgentStep[],
    checkpointId: row.checkpoint_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Caps a tool result at 24 KB, telling the model how much was left out. */
export function truncateResult(result: string): string {
  const bytes = Buffer.byteLength(result, 'utf8');
  if (bytes <= TOOL_RESULT_MAX_BYTES) return result;
  const kept = Buffer.from(result, 'utf8').subarray(0, TOOL_RESULT_MAX_BYTES).toString('utf8');
  return `${kept}\n[truncated: ${bytes - Buffer.byteLength(kept, 'utf8')} bytes omitted]`;
}

function summarize(result: string): string {
  const firstLine = result.split('\n', 1)[0] ?? '';
  return firstLine.length > SUMMARY_MAX_CHARS
    ? `${firstLine.slice(0, SUMMARY_MAX_CHARS)}…`
    : firstLine;
}

export interface PreparedAgentTurn {
  chat: AgentChat;
  config: ProviderConfig;
  history: AgentMessage[];
  userContent: string;
  assistant: AgentMessage;
  release(): void;
}

/**
 * The story-skills agent (ADR 0015): a bounded tool-calling loop over one
 * book. Each turn streams the model's text, runs the tools it calls, and
 * feeds the results back until the model answers without tools or the step
 * limit is reached. Every request body and tool result is recorded on the
 * assistant message, and every file the turn changed lands in one
 * checkpoint, committed even when the turn is stopped or fails, so it can
 * always be undone.
 */
export class AgentService {
  private readonly active = new Set<string>();

  constructor(
    private readonly db: Database.Database,
    private readonly books: BookService,
    private readonly skills: SkillService,
    private readonly presets: PresetService,
    private readonly providers: ProviderService,
    private readonly tools: AgentToolRegistry,
    private readonly logError: (error: unknown) => void = () => undefined,
  ) {}

  createChat(book: string, title?: string): AgentChat {
    this.books.root(book);
    const now = new Date().toISOString();
    const row: AgentChatRow = {
      id: randomUUID(),
      book,
      title: title ?? 'New chat',
      created_at: now,
      updated_at: now,
    };
    this.db
      .prepare(
        'INSERT INTO agent_chats (id, book, title, created_at, updated_at) VALUES (@id, @book, @title, @created_at, @updated_at)',
      )
      .run(row);
    return toChat(row);
  }

  listChats(book: string): AgentChat[] {
    this.books.root(book);
    return (
      this.db
        .prepare('SELECT * FROM agent_chats WHERE book = ? ORDER BY updated_at DESC, id')
        .all(book) as AgentChatRow[]
    ).map(toChat);
  }

  getChat(id: string): AgentChatDetail {
    const chat = this.chatRow(id);
    const messages = (
      this.db
        .prepare('SELECT * FROM agent_messages WHERE chat_id = ? ORDER BY seq')
        .all(id) as AgentMessageRow[]
    ).map(toMessage);
    return { ...toChat(chat), messages };
  }

  deleteChat(id: string): void {
    this.chatRow(id);
    this.db.prepare('DELETE FROM agent_chats WHERE id = ?').run(id);
  }

  /** Validates the turn can run and records the user message and a streaming assistant message. */
  prepare(chatId: string, content: string): PreparedAgentTurn {
    if (this.active.has(chatId)) {
      throw new ConflictError(
        'generation_in_progress',
        'The agent is already working in this chat.',
      );
    }
    const detail = this.getChat(chatId);
    const config = this.presets.getSettings().providerConfig;
    if (!config) throw new ConfigurationError('Configure a provider before talking to the agent.');
    if (!supportsTools(config.source)) {
      throw new ConfigurationError(
        'The configured provider does not support tool calling, which the agent needs.',
      );
    }
    this.active.add(chatId);
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        this.active.delete(chatId);
      }
    };
    try {
      const now = new Date().toISOString();
      const seq = detail.messages.length;
      const insert = this.db.prepare(
        `INSERT INTO agent_messages (id, chat_id, seq, role, content, reasoning, status, steps_json, checkpoint_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, '[]', NULL, ?, ?)`,
      );
      const assistantId = randomUUID();
      this.db.transaction(() => {
        insert.run(randomUUID(), chatId, seq, 'user', content, 'complete', now, now);
        insert.run(assistantId, chatId, seq + 1, 'assistant', '', 'streaming', now, now);
        const title = detail.messages.length === 0 ? content.slice(0, 80) : detail.title;
        this.db
          .prepare('UPDATE agent_chats SET title = ?, updated_at = ? WHERE id = ?')
          .run(title, now, chatId);
      })();
      return {
        chat: detail,
        config,
        history: detail.messages,
        userContent: content,
        assistant: this.message(assistantId),
        release,
      };
    } catch (error) {
      release();
      throw error;
    }
  }

  async run(
    prepared: PreparedAgentTurn,
    signal: AbortSignal,
    emit: (event: AgentStreamEvent) => void,
  ): Promise<void> {
    const { chat, config } = prepared;
    const controls = this.presets.resolve(null).generation;
    const session: CheckpointSession = this.books.startSession(
      chat.book,
      `Agent: ${prepared.userContent.slice(0, 60)}`,
      'agent',
    );
    const messages: ChatMessage[] = [
      { role: 'system', content: this.systemPrompt(chat.book) },
      ...prepared.history
        .filter((message) => message.content.trim() !== '')
        .map((message) => ({ role: message.role, content: message.content })),
      { role: 'user', content: prepared.userContent },
    ];
    const steps: AgentStep[] = [];
    const texts: string[] = [];
    let reasoning = '';
    let limited = false;

    const persist = (status: AgentMessage['status'], checkpointId: string | null = null) => {
      const content = [...texts, ...(limited ? [`(Stopped after ${AGENT_MAX_STEPS} steps.)`] : [])]
        .filter((text) => text.trim() !== '')
        .join('\n\n');
      this.db
        .prepare(
          'UPDATE agent_messages SET content = ?, reasoning = ?, status = ?, steps_json = ?, checkpoint_id = ?, updated_at = ? WHERE id = ?',
        )
        .run(
          content,
          reasoning || null,
          status,
          JSON.stringify(steps),
          checkpointId,
          new Date().toISOString(),
          prepared.assistant.id,
        );
      return this.message(prepared.assistant.id);
    };
    const finishCheckpoint = () => {
      const checkpoint = this.books.commitSession(session);
      if (checkpoint) emit({ type: 'checkpoint', checkpoint });
      return checkpoint?.id ?? null;
    };

    try {
      for (let index = 0; ; index += 1) {
        if (index === AGENT_MAX_STEPS) {
          limited = true;
          break;
        }
        emit({ type: 'step', index });
        const request = this.providers.createChatRequest(
          config,
          messages,
          controls,
          this.tools.definitions(),
        );
        const step: AgentStep = {
          index,
          requestBody: this.providers.snapshotRequestBody(request),
          text: '',
          toolCalls: [],
        };
        steps.push(step);
        texts.push('');

        const accumulator = new ToolCallAccumulator();
        const stream = await this.providers.openChatStream(config.source, request, signal);
        for await (const event of parseSseStream(stream)) {
          if (event.data === '[DONE]') break;
          let payload: unknown;
          try {
            payload = JSON.parse(event.data);
          } catch {
            throw new ProviderError('Provider stream contained invalid JSON.', config.source);
          }
          accumulator.push(payload);
          const delta = normalizeStreamChunk(config.source, payload);
          if (!delta) continue;
          step.text += delta.text;
          texts[texts.length - 1] = step.text;
          reasoning += delta.reasoning ?? '';
          emit({
            type: 'delta',
            text: delta.text,
            ...(delta.reasoning ? { reasoning: delta.reasoning } : {}),
          });
        }

        const calls = accumulator.toolCalls();
        if (calls.length === 0) break;
        messages.push({
          role: 'assistant',
          content: step.text === '' ? null : step.text,
          tool_calls: calls.map((call) => ({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: call.arguments },
            ...(call.signature ? { signature: call.signature } : {}),
          })),
        });
        for (const call of calls) {
          emit({
            type: 'tool_call',
            stepIndex: index,
            id: call.id,
            name: call.name,
            arguments: call.arguments,
          });
          const started = Date.now();
          const outcome = await this.tools.execute(call.name, call.arguments, {
            book: chat.book,
            session,
          });
          const result = truncateResult(outcome.result);
          step.toolCalls.push({
            id: call.id,
            name: call.name,
            arguments: call.arguments,
            ok: outcome.ok,
            result,
            durationMs: Date.now() - started,
          });
          emit({
            type: 'tool_result',
            stepIndex: index,
            id: call.id,
            ok: outcome.ok,
            summary: summarize(result),
          });
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: outcome.ok ? result : `Error: ${result}`,
          });
        }
        persist('streaming');
        if (signal.aborted) break;
      }

      if (signal.aborted) {
        persist('interrupted', finishCheckpoint());
        return;
      }
      emit({ type: 'done', message: persist('complete', finishCheckpoint()) });
    } catch (error) {
      const checkpointId = finishCheckpoint();
      if (signal.aborted) {
        persist('interrupted', checkpointId);
        return;
      }
      this.logError(error);
      const messageState = persist('error', checkpointId);
      if (error instanceof ProviderError) {
        emit({
          type: 'error',
          code: 'provider_error',
          message: 'Provider generation failed',
          messageState,
        });
      } else if (error instanceof ConfigurationError) {
        emit({ type: 'error', code: 'configuration_error', message: error.message, messageState });
      } else {
        emit({
          type: 'error',
          code: 'internal_error',
          message: 'Internal server error',
          messageState,
        });
      }
    } finally {
      this.db
        .prepare('UPDATE agent_chats SET updated_at = ? WHERE id = ?')
        .run(new Date().toISOString(), chat.id);
    }
  }

  /** The agent's standing instructions, skill catalog, and book facts. */
  systemPrompt(book: string): string {
    const summary = this.books.get(book);
    const skills = this.skills.list();
    const counts = Object.entries(summary.counts)
      .map(([kind, count]) => `${count} ${kind}`)
      .join(', ');
    return [
      `You are the story-skills agent in worldbookllm, working on the book "${summary.title}".`,
      'The book is a story-skills project: plain Markdown files with YAML frontmatter, one entity per file (characters/, worldbuilding/, plot/, chapters/, scenes/, continuity/, glossary/, research/). The filename is the entity id; _index.md registries are generated by story reindex.',
      'Use the tools to read and change the book. Run the story CLI only through run_story (never bun, node, or npx); the server supplies --path and --json.',
      'Your file changes apply immediately and are recorded as one undoable change for this turn. Tell the user what you changed.',
      'Ask the user before inventing canon they have not given you.',
      'When a request matches a skill below, load it with activate_skill and follow it; load its references with read_skill_file when it says to.',
      '',
      '## Skills',
      ...(skills.length === 0
        ? ['No skills are installed.']
        : skills.map((skill) => `- ${skill.name}: ${skill.description}`)),
      '',
      '## Book',
      `Title: ${summary.title}`,
      `Genre: ${summary.genre ?? 'unset'} · Status: ${summary.status ?? 'unset'}`,
      `Contents: ${counts || 'no entities yet'}`,
    ].join('\n');
  }

  private chatRow(id: string): AgentChatRow {
    const row = this.db.prepare('SELECT * FROM agent_chats WHERE id = ?').get(id) as
      AgentChatRow | undefined;
    if (!row) throw new NotFoundError(`Chat ${id} was not found`);
    return row;
  }

  private message(id: string): AgentMessage {
    return toMessage(
      this.db.prepare('SELECT * FROM agent_messages WHERE id = ?').get(id) as AgentMessageRow,
    );
  }
}
