import type {
  AgentChangeset,
  AgentMessage,
  AgentStreamEvent,
  Checkpoint,
} from '@worldbookllm/shared';
import {
  ASK_USER_TOOL,
  askUserArgumentsSchema,
  bookSlugSchema,
  type AskUserQuestion,
} from '@worldbookllm/shared';

export interface ToolCallView {
  id: string;
  name: string;
  arguments: string;
  status: 'running' | 'ok' | 'failed';
  /** The full result for a recorded call, or the one-line summary while streaming. */
  result: string | null;
}

export interface StepView {
  index: number;
  text: string;
  calls: ToolCallView[];
}

/** A turn in flight, built up from the agent's stream events. */
export interface PendingTurn {
  userContent: string;
  pinnedPaths: readonly string[];
  steps: StepView[];
  reasoning: string;
  checkpoint: Checkpoint | null;
  seriesBooks: string[];
  /** Review mode: the changes the turn proposes, announced when it ends. */
  changeset: AgentChangeset | null;
  stopping: boolean;
}

export function startTurn(userContent: string, pinnedPaths: readonly string[] = []): PendingTurn {
  return {
    userContent,
    pinnedPaths,
    steps: [],
    reasoning: '',
    checkpoint: null,
    seriesBooks: [],
    changeset: null,
    stopping: false,
  };
}

function updateStep(turn: PendingTurn, index: number, change: (step: StepView) => StepView) {
  return {
    ...turn,
    steps: turn.steps.map((step) => (step.index === index ? change(step) : step)),
  };
}

/** Folds one stream event into the pending turn; terminal events leave it unchanged. */
export function applyAgentEvent(turn: PendingTurn, event: AgentStreamEvent): PendingTurn {
  switch (event.type) {
    case 'step':
      return { ...turn, steps: [...turn.steps, { index: event.index, text: '', calls: [] }] };
    case 'delta': {
      const reasoning = turn.reasoning + (event.reasoning ?? '');
      const last = turn.steps.at(-1);
      if (last === undefined) return { ...turn, reasoning };
      return updateStep({ ...turn, reasoning }, last.index, (step) => ({
        ...step,
        text: step.text + event.text,
      }));
    }
    case 'tool_call':
      return updateStep(turn, event.stepIndex, (step) => ({
        ...step,
        calls: [
          ...step.calls,
          {
            id: event.id,
            name: event.name,
            arguments: event.arguments,
            status: 'running',
            result: null,
          },
        ],
      }));
    case 'tool_result':
      return updateStep(turn, event.stepIndex, (step) => ({
        ...step,
        calls: step.calls.map((call) =>
          call.id === event.id
            ? { ...call, status: event.ok ? 'ok' : 'failed', result: event.summary }
            : call,
        ),
      }));
    case 'checkpoint':
      return { ...turn, checkpoint: event.checkpoint };
    case 'series_sync':
      return {
        ...turn,
        seriesBooks: [
          ...new Set([
            ...turn.seriesBooks,
            ...event.checkpoints.map((checkpoint) => checkpoint.book),
          ]),
        ],
      };
    case 'changeset':
      return { ...turn, changeset: event.changeset };
    default:
      return turn;
  }
}

/** Sync results persist their compact book list, independent of checkpoint diff size. */
export function seriesBooksOf(steps: readonly StepView[]): string[] {
  const books = new Set<string>();
  for (const call of steps.flatMap((step) => step.calls)) {
    if (call.name !== 'sync_series' || call.status !== 'ok' || call.result === null) continue;
    try {
      const result = JSON.parse(call.result) as { books?: unknown };
      if (!Array.isArray(result.books)) continue;
      for (const book of result.books)
        if (bookSlugSchema.safeParse(book).success) books.add(book as string);
    } catch {
      /* Failed or truncated legacy results do not become navigation links. */
    }
  }
  return [...books];
}

/** The recorded steps of an assistant message, in the same shape as a pending turn. */
export function stepsOf(message: AgentMessage): StepView[] {
  return message.steps.map((step) => ({
    index: step.index,
    text: step.text,
    calls: step.toolCalls.map((call) => ({
      id: call.id,
      name: call.name,
      arguments: call.arguments,
      status: call.ok ? 'ok' : 'failed',
      result: call.result,
    })),
  }));
}

/**
 * Text the message carries beyond its steps (such as the step-limit note),
 * mirroring how the server joins step texts into the message content.
 */
export function extraText(message: AgentMessage): string {
  if (message.steps.length === 0) return message.content;
  const fromSteps = message.steps
    .map((step) => step.text)
    .filter((text) => text.trim() !== '')
    .join('\n\n');
  if (message.content === fromSteps) return '';
  if (fromSteps === '') return message.content;
  return message.content.startsWith(`${fromSteps}\n\n`)
    ? message.content.slice(fromSteps.length + 2)
    : '';
}

const TARGET_KEYS = ['path', 'query', 'skill', 'name', 'file'] as const;

/** The argument that says what a tool call acted on, for its chip label. */
export function toolTarget(argumentsJson: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argumentsJson);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  // run_story: the command and its positionals, e.g. "add character Mara".
  if (typeof record.command === 'string') {
    const args = Array.isArray(record.args)
      ? record.args.filter((arg): arg is string => typeof arg === 'string')
      : [];
    return [record.command, ...args].join(' ');
  }
  for (const key of TARGET_KEYS) {
    const value = record[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return null;
}

/** Pretty-prints a JSON arguments string, or returns it as sent when it is not JSON. */
export function prettyArguments(argumentsJson: string): string {
  try {
    return JSON.stringify(JSON.parse(argumentsJson), null, 2);
  } catch {
    return argumentsJson;
  }
}

/** The questions an `ask_user` call asked, or null when its arguments do not parse. */
export function questionsOf(call: { name: string; arguments: string }): AskUserQuestion[] | null {
  if (call.name !== ASK_USER_TOOL) return null;
  try {
    const parsed = askUserArgumentsSchema.safeParse(JSON.parse(call.arguments));
    return parsed.success ? parsed.data.questions : null;
  } catch {
    return null;
  }
}

export interface PendingQuestion {
  callId: string;
  questions: AskUserQuestion[];
}

/**
 * The question the agent is waiting on: the chat's last message is a finished
 * turn whose last step asked the writer with `ask_user`.
 */
export function pendingQuestion(messages: readonly AgentMessage[]): PendingQuestion | null {
  const last = [...messages].sort((left, right) => left.seq - right.seq).at(-1);
  if (last?.role !== 'assistant' || last.status !== 'complete') return null;
  const calls = last.steps.at(-1)?.toolCalls ?? [];
  for (const call of [...calls].reverse()) {
    if (!call.ok) continue;
    const questions = questionsOf(call);
    if (questions !== null) return { callId: call.id, questions };
  }
  return null;
}

/** The writer's answer to one question: the options picked, and any written answer. */
export interface QuestionAnswer {
  selected: string[];
  other: boolean;
  text: string;
}

export function emptyAnswers(questions: readonly AskUserQuestion[]): QuestionAnswer[] {
  return questions.map(() => ({ selected: [], other: false, text: '' }));
}

function answerValues(answer: QuestionAnswer | undefined): string[] {
  if (answer === undefined) return [];
  const written = answer.other ? answer.text.trim() : '';
  return [...answer.selected, ...(written === '' ? [] : [written])];
}

export function isAnswered(answer: QuestionAnswer | undefined): boolean {
  return answerValues(answer).length > 0;
}

/**
 * The message that answers the questions: the answer alone for one question,
 * otherwise one labelled line per question.
 */
export function composeAnswer(
  questions: readonly AskUserQuestion[],
  answers: readonly QuestionAnswer[],
): string {
  if (questions.length === 1) return answerValues(answers[0]).join(', ');
  return questions
    .map(
      (question, index) =>
        `**${question.header === undefined ? question.question : `${question.header}:`}** ${answerValues(answers[index]).join(', ')}`,
    )
    .join('\n');
}
