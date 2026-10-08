import type { ChatMessage } from '@worldbookllm/providers';

/**
 * Keeps the agent's resent conversation within bounds without making it
 * forget. Every step of a turn resends the whole conversation. Earlier turns
 * are replayed verbatim while they fit a budget, so the agent still has what
 * it read and wrote a message ago, and prompt caching bills the repeated
 * prefix at the cached rate. Only once the history outgrows the budget are
 * the oldest turns compacted: bulk the model can get back (file contents,
 * skill text, text it wrote) becomes a short stub saying how (ADR 0025).
 */

/**
 * Earlier turns replay verbatim while they total at most this many
 * characters of JSON (about 40k tokens), which leaves room for the system
 * prompt, the turn in progress, and tools in a 128k-token context.
 */
export const HISTORY_BUDGET_CHARS = 160_000;

/** Earlier-turn results longer than this keep only their head. */
const EARLIER_RESULT_MAX_CHARS = 2000;
const EARLIER_RESULT_HEAD_CHARS = 500;
/** Earlier-turn edit_file find/replace text longer than this is dropped. */
const EARLIER_EDIT_MAX_CHARS = 500;
/** Tools whose results are replaced whole: a partial file or skill would mislead. */
const RELOADABLE_TOOLS = new Set(['activate_skill', 'read_skill_file']);

interface ToolCallInfo {
  name: string;
  args: Record<string, unknown>;
}

function kilobytes(text: string): string {
  return `${Math.max(1, Math.round(text.length / 1024))} KB`;
}

/** Tool call arguments arrive as a JSON string or, from some providers, already parsed. */
function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw !== null && typeof raw === 'object') return { ...(raw as Record<string, unknown>) };
  if (typeof raw !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Tool calls by id, from the assistant messages that made them. */
function callsById(messages: readonly ChatMessage[]): Map<string, ToolCallInfo> {
  const calls = new Map<string, ToolCallInfo>();
  for (const message of messages) {
    for (const call of message.tool_calls ?? []) {
      calls.set(call.id, { name: call.function.name, args: parseArgs(call.function.arguments) });
    }
  }
  return calls;
}

/**
 * Calls whose result is an error. A failed write or edit never landed, so its
 * arguments are the only copy of the text the model will want to correct.
 */
function failedCallIds(messages: readonly ChatMessage[]): Set<string> {
  const failed = new Set<string>();
  for (const message of messages) {
    if (
      message.role === 'tool' &&
      message.tool_call_id !== undefined &&
      String(message.content).startsWith('Error: ')
    ) {
      failed.add(message.tool_call_id);
    }
  }
  return failed;
}

/** A file's identity across tools: the same path in another series book is another file. */
function fileKey(args: Record<string, unknown>): string | null {
  if (typeof args.path !== 'string') return null;
  return `${typeof args.book === 'string' ? args.book : ''}\u0000${args.path}`;
}

function isStub(text: unknown): boolean {
  return typeof text === 'string' && text.startsWith('[') && text.endsWith(']');
}

function withArgs(
  message: ChatMessage,
  id: string,
  update: (args: Record<string, unknown>) => void,
): ChatMessage {
  return {
    ...message,
    tool_calls: message.tool_calls!.map((call) => {
      if (call.id !== id) return call;
      const args = parseArgs(call.function.arguments);
      update(args);
      const encoded = typeof call.function.arguments === 'string' ? JSON.stringify(args) : args;
      return { ...call, function: { ...call.function, arguments: encoded } };
    }),
  };
}

function compactResult(call: ToolCallInfo | undefined, content: string): string {
  if (content.startsWith('Error: ') || content.length <= EARLIER_RESULT_MAX_CHARS) return content;
  if (call?.name === 'read_file') {
    const path = typeof call.args.path === 'string' ? call.args.path : 'This file';
    return `[${path}: read in an earlier turn (${kilobytes(content)}). Its contents are omitted to save context; call read_file again if you need them.]`;
  }
  if (call !== undefined && RELOADABLE_TOOLS.has(call.name)) {
    return `[Skill text loaded in an earlier turn (${kilobytes(content)}) is omitted to save context; call ${call.name} again if you need it.]`;
  }
  const omitted = content.length - EARLIER_RESULT_HEAD_CHARS;
  return `${content.slice(0, EARLIER_RESULT_HEAD_CHARS)}\n[… ${omitted} more characters from an earlier turn omitted; run the tool again if you need them.]`;
}

/** Finished turns: each starts at a user message and runs to the next one. */
function splitTurns(messages: readonly ChatMessage[]): ChatMessage[][] {
  const turns: ChatMessage[][] = [];
  for (const message of messages) {
    if (message.role === 'user' || turns.length === 0) turns.push([]);
    turns.at(-1)!.push(message);
  }
  return turns;
}

/**
 * The first turn to replay verbatim. Turns before it are compacted.
 *
 * The boundary only ever moves to a mark, the first turn after each further
 * half-budget of history. Marks depend only on earlier turns, which never
 * change, so the boundary stays put while the history grows by up to half a
 * budget at a time. Each move rewrites the cached prefix once, instead of on
 * every turn once the history is full. The latest earlier turn always stays
 * verbatim, whatever its size.
 */
function verbatimFrom(sizes: readonly number[], budget: number): number {
  let remaining = sizes.reduce((sum, size) => sum + size, 0);
  if (remaining <= budget) return 0;
  const step = budget / 2;
  let cumulative = 0;
  let nextMark = step;
  for (const [index, size] of sizes.entries()) {
    if (cumulative >= nextMark) {
      while (cumulative >= nextMark) nextMark += step;
      if (remaining <= budget) return index;
    }
    cumulative += size;
    remaining -= size;
  }
  return Math.max(0, sizes.length - 1);
}

/**
 * Fits the replayed history of finished turns into `budget` characters: the
 * most recent turns stay verbatim and the oldest are compacted, as little
 * and as rarely as the budget allows.
 */
export function fitEarlierTurns(
  messages: readonly ChatMessage[],
  budget: number = HISTORY_BUDGET_CHARS,
): ChatMessage[] {
  const turns = splitTurns(messages);
  const from = verbatimFrom(
    turns.map((turn) => JSON.stringify(turn).length),
    budget,
  );
  return [...compactEarlierTurns(turns.slice(0, from).flat()), ...turns.slice(from).flat()];
}

/**
 * Compacts the replayed history of old turns. The conversation, tool calls,
 * and short results stay as they were; bulk is stubbed.
 */
export function compactEarlierTurns(messages: readonly ChatMessage[]): ChatMessage[] {
  const calls = callsById(messages);
  const failed = failedCallIds(messages);
  return messages.map((message) => {
    if (message.role === 'tool' && typeof message.content === 'string') {
      const call = calls.get(message.tool_call_id ?? '');
      return { ...message, content: compactResult(call, message.content) };
    }
    let compacted = message;
    for (const call of message.tool_calls ?? []) {
      if (failed.has(call.id)) continue;
      const args = parseArgs(call.function.arguments);
      if (call.function.name === 'write_file' && typeof args.content === 'string') {
        if (isStub(args.content)) continue;
        const size = kilobytes(args.content);
        compacted = withArgs(compacted, call.id, (next) => {
          next.content = `[${size} written in an earlier turn; read the file if you need it]`;
        });
      } else if (call.function.name === 'edit_file') {
        compacted = withArgs(compacted, call.id, (next) => {
          for (const field of ['find', 'replace'] as const) {
            const text = next[field];
            if (typeof text === 'string' && text.length > EARLIER_EDIT_MAX_CHARS && !isStub(text)) {
              next[field] = `[${text.length} characters omitted from an earlier turn]`;
            }
          }
        });
      }
    }
    return compacted;
  });
}

/**
 * Within the turn in progress, stubs a file's earlier reads, and the text of
 * an earlier write to it, once the file has been read again: the later read
 * is the current one. Edits are left alone, since the model may still edit
 * from an earlier read. Mutates `messages`; running it twice changes nothing.
 */
export function supersedeRepeatedReads(messages: ChatMessage[]): void {
  const calls = callsById(messages);
  const failed = failedCallIds(messages);
  const lastRead = new Map<string, number>();
  messages.forEach((message, index) => {
    const call = message.role === 'tool' ? calls.get(message.tool_call_id ?? '') : undefined;
    const key = call?.name === 'read_file' ? fileKey(call.args) : null;
    if (key !== null && !String(message.content).startsWith('Error: ')) lastRead.set(key, index);
  });
  messages.forEach((message, index) => {
    if (message.role === 'tool') {
      const call = calls.get(message.tool_call_id ?? '');
      const key = call?.name === 'read_file' ? fileKey(call.args) : null;
      const content = String(message.content);
      if (key === null || isStub(content) || content.startsWith('Error: ')) return;
      if ((lastRead.get(key) ?? index) > index) {
        messages[index] = {
          ...message,
          content: `[${String(call!.args.path)}: this earlier read is superseded by a later read_file of the same file below.]`,
        };
      }
      return;
    }
    for (const call of message.tool_calls ?? []) {
      if (call.function.name !== 'write_file' || failed.has(call.id)) continue;
      const args = parseArgs(call.function.arguments);
      const key = fileKey(args);
      if (key === null || typeof args.content !== 'string' || isStub(args.content)) continue;
      if ((lastRead.get(key) ?? index) > index) {
        const size = kilobytes(args.content);
        messages[index] = withArgs(messages[index]!, call.id, (next) => {
          next.content = `[${size} written; superseded by a later read_file of this file]`;
        });
      }
    }
  });
}
