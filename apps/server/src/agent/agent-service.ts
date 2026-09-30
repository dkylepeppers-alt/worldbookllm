import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';

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
  CreateAgentChatInput,
  CustomAgent,
  PatchAgentChatInput,
  ProviderConfig,
} from '@worldbookllm/shared';

import { ConfigurationError, ConflictError, NotFoundError } from '../errors.js';
import type { BookService } from '../services/books.js';
import type { PresetService } from '../services/presets.js';
import type { ProviderService } from '../services/providers.js';
import type { SkillService } from '../services/skills.js';
import type { CheckpointSession } from '../story/checkpoints.js';
import type { StagedBook } from '../story/staging.js';
import type { AgentChangesetService } from './changesets.js';
import type { CustomAgentService } from './custom-agents.js';
import type { AgentToolRegistry, ToolContext } from './tools.js';
import { LiveWorkspace, type AgentWorkspace } from './workspace.js';

export const AGENT_MAX_STEPS = 24;
const TOOL_RESULT_MAX_BYTES = 24 * 1024;
const SUMMARY_MAX_CHARS = 200;

interface AgentChatRow {
  id: string;
  book: string;
  title: string;
  agent_id: string | null;
  review_mode: 0 | 1 | null;
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
  note: string | null;
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
    agentId: row.agent_id,
    reviewMode: row.review_mode === null ? null : row.review_mode === 1,
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
    note: row.note,
    steps: JSON.parse(row.steps_json) as AgentStep[],
    checkpointId: row.checkpoint_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function omissionNotice(omitted: number): string {
  return `\n[truncated: ${omitted} bytes omitted]`;
}

/**
 * Caps a tool result at 24 KB, including the omission notice, and never cuts
 * inside a UTF-8 character.
 */
export function truncateResult(result: string): string {
  const buf = Buffer.from(result, 'utf8');
  if (buf.length <= TOOL_RESULT_MAX_BYTES) return result;

  // A continuation byte is 10xxxxxx. Walk back to the start of the character.
  const boundary = (index: number): number => {
    let end = index;
    while (end > 0 && (buf[end]! & 0xc0) === 0x80) end -= 1;
    return end;
  };

  let kept = boundary(
    Math.max(0, TOOL_RESULT_MAX_BYTES - Buffer.byteLength(omissionNotice(buf.length), 'utf8')),
  );
  let notice = omissionNotice(buf.length - kept);
  while (kept > 0 && kept + Buffer.byteLength(notice, 'utf8') > TOOL_RESULT_MAX_BYTES) {
    kept = boundary(kept - 1);
    notice = omissionNotice(buf.length - kept);
  }
  return `${buf.subarray(0, kept).toString('utf8')}${notice}`;
}

/**
 * Arguments sent back to the provider. A malformed JSON string would make
 * Claude's next request fail to build (`JSON.parse` in convertClaudeMessages),
 * so the provider sees an empty object and the tool result carries the error.
 * The recorded step keeps the raw string.
 */
export function providerToolArguments(raw: string): string {
  try {
    JSON.parse(raw);
    return raw;
  } catch {
    return '{}';
  }
}

/** Rebuilds the provider conversation, including tool calls stored on each step. */
/** A user message as the model receives it: the app's note (if any), then the writer's words. */
export function userText(content: string, note: string | null): string {
  return note === null ? content : `${note}\n\n${content}`;
}

export function historyMessages(history: AgentMessage[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const message of history) {
    if (message.role === 'user') {
      if (message.content.trim() !== '') {
        messages.push({ role: 'user', content: userText(message.content, message.note) });
      }
      continue;
    }
    if (message.steps.length === 0) {
      if (message.content.trim() !== '') {
        messages.push({ role: 'assistant', content: message.content });
      }
      continue;
    }
    for (const step of message.steps) {
      if (step.toolCalls.length > 0) {
        messages.push({
          role: 'assistant',
          content: step.text === '' ? null : step.text,
          tool_calls: step.toolCalls.map((call) => ({
            id: call.id,
            type: 'function' as const,
            function: { name: call.name, arguments: providerToolArguments(call.arguments) },
          })),
        });
        for (const call of step.toolCalls) {
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: call.ok ? call.result : `Error: ${call.result}`,
          });
        }
      } else if (step.text.trim() !== '') {
        messages.push({ role: 'assistant', content: step.text });
      }
    }
    const fromSteps = message.steps
      .map((step) => step.text)
      .filter((text) => text.trim() !== '')
      .join('\n\n');
    const extra =
      message.content === fromSteps
        ? ''
        : fromSteps.length === 0
          ? message.content
          : message.content.startsWith(`${fromSteps}\n\n`)
            ? message.content.slice(fromSteps.length + 2)
            : '';
    if (extra.trim() !== '') messages.push({ role: 'assistant', content: extra });
  }
  return messages;
}

/** Gemma 3 on Google sources is sent no tools (see buildGoogleRequest). */
function googleModelWithoutTools(config: ProviderConfig): boolean {
  return (
    (config.source === 'makersuite' || config.source === 'vertexai') && /gemma-3/.test(config.model)
  );
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
  /** What the app tells the model alongside the message, such as review outcomes. */
  note: string | null;
  /** The chat's custom agent; null for the default agent. */
  agent: CustomAgent | null;
  /** Review mode: stage the turn's changes for the writer instead of applying them. */
  reviewMode: boolean;
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
 * always be undone. In review mode (ADR 0016) the turn works on a staged
 * copy instead, and its changes become a changeset the writer reviews.
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
    private readonly changesets: AgentChangesetService,
    private readonly agents: CustomAgentService,
    private readonly stagingDir: string,
    private readonly logError: (error: unknown) => void = () => undefined,
  ) {
    // Staged copies belong to turns, and no turn outlives the process.
    rmSync(this.stagingDir, { recursive: true, force: true });
    // No turn survives a restart. A message still marked streaming was cut
    // off by the process exiting; record it as interrupted so it does not
    // look like a turn in progress forever.
    this.db
      .prepare("UPDATE agent_messages SET status = 'interrupted' WHERE status = 'streaming'")
      .run();
  }

  createChat(book: string, input: CreateAgentChatInput = {}): AgentChat {
    this.books.root(book);
    if (input.agentId) this.agents.get(input.agentId);
    const now = new Date().toISOString();
    const row: AgentChatRow = {
      id: randomUUID(),
      book,
      title: input.title ?? 'New chat',
      agent_id: input.agentId ?? null,
      review_mode:
        input.reviewMode === undefined || input.reviewMode === null
          ? null
          : input.reviewMode
            ? 1
            : 0,
      created_at: now,
      updated_at: now,
    };
    this.db
      .prepare(
        `INSERT INTO agent_chats (id, book, title, agent_id, review_mode, created_at, updated_at)
         VALUES (@id, @book, @title, @agent_id, @review_mode, @created_at, @updated_at)`,
      )
      .run(row);
    return toChat(row);
  }

  /** Changes the chat's agent or review mode; takes effect from the next turn. */
  patchChat(id: string, input: PatchAgentChatInput): AgentChat {
    const current = this.chatRow(id);
    if (input.agentId) this.agents.get(input.agentId);
    const agentId = input.agentId === undefined ? current.agent_id : input.agentId;
    const reviewMode =
      input.reviewMode === undefined
        ? current.review_mode
        : input.reviewMode === null
          ? null
          : input.reviewMode
            ? 1
            : 0;
    this.db
      .prepare('UPDATE agent_chats SET agent_id = ?, review_mode = ?, updated_at = ? WHERE id = ?')
      .run(agentId, reviewMode, new Date().toISOString(), id);
    return toChat(this.chatRow(id));
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
    return { ...toChat(chat), messages, changesets: this.changesets.listForChat(id) };
  }

  deleteChat(id: string): void {
    this.chatRow(id);
    if (this.active.has(id)) {
      throw new ConflictError(
        'generation_in_progress',
        'This chat has a turn running. Wait for it to finish before deleting it.',
      );
    }
    this.db.prepare('DELETE FROM agent_chats WHERE id = ?').run(id);
  }

  /** Refuses trash while one of the book's chats has a turn running. */
  assertBookIdle(book: string): void {
    const ids = this.db
      .prepare('SELECT id FROM agent_chats WHERE book = ?')
      .pluck()
      .all(book) as string[];
    if (ids.some((id) => this.active.has(id))) {
      throw new ConflictError(
        'generation_in_progress',
        'An agent turn is running in this book. Wait for it to finish before trashing it.',
      );
    }
  }

  /** Removes the book's agent chats. Caller must have checked assertBookIdle. */
  removeChatsForBook(book: string): void {
    this.db.prepare('DELETE FROM agent_chats WHERE book = ?').run(book);
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
    const settings = this.presets.getSettings();
    const config = settings.providerConfig;
    if (!config) throw new ConfigurationError('Configure a provider before talking to the agent.');
    if (!supportsTools(config.source)) {
      throw new ConfigurationError(
        'The configured provider does not support tool calling, which the agent needs.',
      );
    }
    if (googleModelWithoutTools(config)) {
      throw new ConfigurationError(
        'Gemma 3 models on Google sources do not support tool calling, which the agent needs.',
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
      const agent = detail.agentId === null ? null : this.agents.get(detail.agentId);
      const insert = this.db.prepare(
        `INSERT INTO agent_messages (id, chat_id, seq, role, content, reasoning, status, note, steps_json, checkpoint_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, '[]', NULL, ?, ?)`,
      );
      const assistantId = randomUUID();
      let note: string | null = null;
      this.db.transaction(() => {
        // Reporting a review outcome marks it told; the transaction keeps
        // that from happening unless the message that carries it is stored.
        note = this.changesets.outcomeNote(chatId);
        insert.run(randomUUID(), chatId, seq, 'user', content, 'complete', note, now, now);
        insert.run(assistantId, chatId, seq + 1, 'assistant', '', 'streaming', null, now, now);
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
        note,
        agent,
        reviewMode: detail.reviewMode ?? settings.agentReviewMode,
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
    const steps: AgentStep[] = [];
    const texts: string[] = [];
    let reasoning = '';
    let limited = false;
    let session: CheckpointSession | undefined;
    let staged: StagedBook | undefined;

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
    let checkpointSettled = false;
    let checkpointId: string | null = null;
    // Ends the turn's changes: commits the checkpoint, or in review mode
    // stores the staged changes as a changeset. Runs even when the turn is
    // stopped or fails, so partial work is still undoable or reviewable.
    const finishCheckpoint = async (): Promise<string | null> => {
      if (checkpointSettled) return checkpointId;
      checkpointSettled = true;
      if (staged) {
        try {
          const changeset = this.changesets.create(
            chat.id,
            prepared.assistant.id,
            chat.book,
            staged.changes(),
          );
          if (changeset) emit({ type: 'changeset', changeset });
        } finally {
          staged.dispose();
        }
        return null;
      }
      if (!session) return null;
      const checkpoint = await this.books.commitSession(session);
      if (checkpoint) emit({ type: 'checkpoint', checkpoint });
      checkpointId = checkpoint?.id ?? null;
      return checkpointId;
    };

    try {
      // Setup stays inside the try: a failure after prepare() has already
      // stored a streaming message must be recorded, not left hanging.
      // Presets were designed for notebook chat. An assistant prefill would be
      // sent as a trailing assistant message on every step and can break
      // tool calling, so the agent never uses one. Presets' role for the
      // agent is to be revisited when the notebook era is retired.
      const controls = { ...this.presets.resolve(null).generation, assistantPrefill: null };
      let workspace: AgentWorkspace;
      if (prepared.reviewMode) {
        staged = await this.books.stage(chat.book, this.stagingDir);
        workspace = staged;
      } else {
        session = this.books.startSession(
          chat.book,
          `Agent: ${prepared.userContent.slice(0, 60)}`,
          'agent',
        );
        workspace = new LiveWorkspace(this.books, session);
      }
      const toolContext: ToolContext = {
        workspace,
        skills: prepared.agent?.skills ? new Set(prepared.agent.skills) : null,
      };
      const messages: ChatMessage[] = [
        {
          role: 'system',
          content: this.systemPrompt(chat.book, {
            agent: prepared.agent,
            reviewMode: prepared.reviewMode,
          }),
        },
        ...historyMessages(prepared.history),
        { role: 'user', content: userText(prepared.userContent, prepared.note) },
      ];

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
        let sawCompletion = false;
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
          sawCompletion = true;
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
        if (calls.length === 0) {
          // The ordinary generation path treats a stream with no completion
          // data as a provider error. A tool call counts as data; a blank
          // step does not.
          if (!sawCompletion) {
            throw new ProviderError('Provider stream contained no completion data.', config.source);
          }
          break;
        }
        messages.push({
          role: 'assistant',
          content: step.text === '' ? null : step.text,
          tool_calls: calls.map((call) => ({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: providerToolArguments(call.arguments) },
            ...(call.signature ? { signature: call.signature } : {}),
          })),
        });
        for (const call of calls) {
          if (signal.aborted) break;
          emit({
            type: 'tool_call',
            stepIndex: index,
            id: call.id,
            name: call.name,
            arguments: call.arguments,
          });
          const started = Date.now();
          const outcome = await this.tools.execute(call.name, call.arguments, toolContext);
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
        // Point the message at the pending checkpoint as soon as it exists:
        // a restart promotes pending checkpoints to history, and the
        // interrupted turn must still show its changes and be undoable.
        persist('streaming', session?.pendingId ?? null);
        if (signal.aborted) break;
      }

      if (signal.aborted) {
        persist('interrupted', await finishCheckpoint());
        return;
      }
      emit({ type: 'done', message: persist('complete', await finishCheckpoint()) });
    } catch (error) {
      let savedCheckpoint: string | null = null;
      try {
        savedCheckpoint = await finishCheckpoint();
      } catch (commitError) {
        this.logError(commitError);
      }
      if (signal.aborted) {
        persist('interrupted', savedCheckpoint);
        return;
      }
      this.logError(error);
      const messageState = persist('error', savedCheckpoint);
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
  systemPrompt(
    book: string,
    options: { agent?: CustomAgent | null; reviewMode?: boolean } = {},
  ): string {
    const { agent = null, reviewMode = false } = options;
    const summary = this.books.get(book);
    const allowed = agent?.skills ? new Set(agent.skills) : null;
    const skills = this.skills
      .list()
      .filter((skill) => allowed === null || allowed.has(skill.name));
    const counts = Object.entries(summary.counts)
      .map(([kind, count]) => `${count} ${kind}`)
      .join(', ');
    return [
      `You are the story-skills agent in worldbookllm, working on the book "${summary.title}".`,
      'The book is a story-skills project: plain Markdown files with YAML frontmatter, one entity per file (characters/, worldbuilding/, plot/, chapters/, scenes/, continuity/, glossary/, research/). The filename is the entity id; _index.md registries are generated by story reindex.',
      'Use the tools to read and change the book. Run the story CLI only through run_story (never bun, node, or npx); the server supplies --path and --json.',
      reviewMode
        ? 'Review mode is on: your file changes are proposed, not applied. You work on a staged copy of the book, so read_file and the story commands show your proposed versions; the writer reviews each changed file after this turn and applies or skips it. story build and export are unavailable. Tell the user what you propose.'
        : 'Your file changes apply immediately and are recorded as one undoable change for this turn. Tell the user what you changed.',
      'Ask the user before inventing canon they have not given you.',
      'When a request matches a skill below, load it with activate_skill and follow it; load its references with read_skill_file when it says to.',
      ...(agent === null || agent.instructions.trim() === ''
        ? []
        : ['', `## Your role: ${agent.name}`, agent.instructions.trim()]),
      '',
      '## Skills',
      ...(skills.length === 0
        ? [allowed === null ? 'No skills are installed.' : 'No skills are available to you.']
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
