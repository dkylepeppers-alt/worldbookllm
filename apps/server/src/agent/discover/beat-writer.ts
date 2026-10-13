import type { ChatMessage, StreamedToolCall, ToolDefinition } from '@worldbookllm/providers';
import type { AgentGeneration, ProviderConfig } from '@worldbookllm/shared';
import type { z } from 'zod';

import { ConflictError, NotFoundError } from '../../errors.js';
import type { ProviderService } from '../../services/providers.js';
import { providerToolArguments, streamStep } from '../provider-step.js';
import { lastJsonObject } from './model-json.js';
import {
  BEAT_TOOLS,
  WRITING_EXAMPLES,
  acceptActionArgs,
  activateSkillArgs,
  readSkillFileArgs,
  declineActionArgs,
  proposeVariableArgs,
  readFileArgs,
  searchArgs,
  writeBeatArgs,
  writeChoicesArgs,
  type BeatToolName,
} from './beat-rules.js';

/**
 * The beat writer's loop (ADR 0033): one bounded tool-calling conversation
 * that ends when a writing tool's handler accepts what the model wrote. A
 * handler that finds problems returns them, and the model gets them back to
 * fix. Reading tools answer and the loop goes on.
 */

const MAX_STEPS = 10;
const RESULT_MAX_CHARS = 16_000;

/** What a writing tool's handler says: done, or the problems to fix. */
export type HandlerOutcome = { done: true; message?: string } | { done: false; problems: string[] };

export interface BeatHandlers {
  read(path: string): string;
  search(query: string): string;
  propose(variable: z.infer<typeof proposeVariableArgs>): string;
  /** The picked agent's skills, when it may use any. */
  skill?(name: string): string;
  skillFile?(name: string, path: string): string;
  write_beat?(args: z.infer<typeof writeBeatArgs>): Promise<HandlerOutcome>;
  write_choices?(args: z.infer<typeof writeChoicesArgs>): Promise<HandlerOutcome>;
  accept_action?(args: z.infer<typeof acceptActionArgs>): Promise<HandlerOutcome>;
  decline_action?(args: z.infer<typeof declineActionArgs>): Promise<HandlerOutcome>;
}

export interface ModelAccess {
  providers: ProviderService;
  config: ProviderConfig;
  controls: AgentGeneration;
  signal: AbortSignal;
}

function definitions(names: readonly BeatToolName[]): ToolDefinition[] {
  return names.map((name) => ({
    type: 'function',
    function: {
      name,
      description: BEAT_TOOLS[name].description,
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: [...BEAT_TOOLS[name].parameters.required],
        properties: BEAT_TOOLS[name].parameters.properties,
      },
    },
  }));
}

function capped(text: string): string {
  return text.length <= RESULT_MAX_CHARS
    ? text
    : `${text.slice(0, RESULT_MAX_CHARS)}\n[…${text.length - RESULT_MAX_CHARS} characters left out]`;
}

function parse<T>(
  schema: z.ZodType<T>,
  raw: string,
): { ok: true; value: T } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(raw === '' ? '{}' : raw);
  } catch {
    return { ok: false, error: 'The arguments are not valid JSON.' };
  }
  const parsed = schema.safeParse(json);
  if (parsed.success) return { ok: true, value: parsed.data };
  return {
    ok: false,
    error: parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'arguments'}: ${issue.message}`)
      .join('; '),
  };
}

/** Thrown when the beat writer stops without finishing. */
export class BeatWriterError extends Error {}

/**
 * Runs the conversation. Resolves with the finishing handler's message once
 * a writing tool's handler is done; throws BeatWriterError when the model
 * runs out of steps or will not call a tool.
 */
export async function runBeatWriter(
  model: ModelAccess,
  input: { system: string; task: string; tools: readonly BeatToolName[]; handlers: BeatHandlers },
): Promise<string | undefined> {
  const tools = [
    ...input.tools,
    'read_file',
    'search',
    'propose_variable',
    ...(input.handlers.skill === undefined ? [] : ['activate_skill', 'read_skill_file']),
  ] as BeatToolName[];
  const messages: ChatMessage[] = [
    { role: 'system', content: input.system },
    { role: 'user', content: input.task },
  ];
  let nudges = 0;
  let lastProblems: string[] = [];
  for (let step = 0; step < MAX_STEPS; step += 1) {
    if (model.signal.aborted) throw new BeatWriterError('Stopped.');
    const request = model.providers.createChatRequest(
      model.config,
      messages,
      model.controls,
      definitions(tools),
    );
    const streamed = await streamStep(model.providers, model.config, request, model.signal);
    const { text } = streamed;
    // A model that writes the tool's arguments as text instead of calling it has still written them.
    const calls = streamed.calls.length > 0 ? streamed.calls : callsInText(text, tools, step);
    if (calls.length === 0) {
      nudges += 1;
      // Some models plan aloud and stop before calling the tool; MAX_STEPS still bounds the whole job.
      if (nudges > 4) throw new BeatWriterError('The model answered without writing the beat.');
      messages.push({ role: 'assistant', content: text });
      messages.push({
        role: 'user',
        content: `Call ${input.tools.join(' or ')} now, with the full arguments; do not describe what you will do. ${input.tools
          .filter((name): name is keyof typeof WRITING_EXAMPLES => name in WRITING_EXAMPLES)
          .map((name) => `${name} takes arguments like ${WRITING_EXAMPLES[name]}`)
          .join('; ')}.`,
      });
      continue;
    }
    messages.push({
      role: 'assistant',
      content: text === '' ? null : text,
      tool_calls: calls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: providerToolArguments(call.arguments) },
        ...(call.signature ? { signature: call.signature } : {}),
      })),
    });
    let finished: string | undefined | null = null;
    for (const call of calls) {
      const reply = (content: string) =>
        messages.push({ role: 'tool', tool_call_id: call.id, content: capped(content) });
      if (finished !== null) {
        reply('Not run: the beat was already written by an earlier call in this step.');
        continue;
      }
      const name = call.name as BeatToolName;
      if (!tools.includes(name)) {
        reply(`Error: ${call.name} is not available. Use ${input.tools.join(' or ')}.`);
        continue;
      }
      try {
        if (name === 'read_file') {
          const args = parse(readFileArgs, call.arguments);
          reply(args.ok ? input.handlers.read(args.value.path) : `Error: ${args.error}`);
          continue;
        }
        if (name === 'activate_skill' && input.handlers.skill) {
          const args = parse(activateSkillArgs, call.arguments);
          reply(args.ok ? input.handlers.skill(args.value.name) : `Error: ${args.error}`);
          continue;
        }
        if (name === 'read_skill_file' && input.handlers.skillFile) {
          const args = parse(readSkillFileArgs, call.arguments);
          reply(
            args.ok
              ? input.handlers.skillFile(args.value.name, args.value.path)
              : `Error: ${args.error}`,
          );
          continue;
        }
        if (name === 'search') {
          const args = parse(searchArgs, call.arguments);
          reply(args.ok ? input.handlers.search(args.value.query) : `Error: ${args.error}`);
          continue;
        }
        if (name === 'propose_variable') {
          const args = parse(proposeVariableArgs, call.arguments);
          reply(args.ok ? input.handlers.propose(args.value) : `Error: ${args.error}`);
          continue;
        }
        const outcome = await runWriting(name, call.arguments, input.handlers);
        if (outcome.done) {
          finished = outcome.message;
          reply('Written.');
        } else {
          lastProblems = outcome.problems;
          reply(
            `Not written. Fix every problem and call ${name} again:\n${outcome.problems.map((problem) => `- ${problem}`).join('\n')}`,
          );
        }
      } catch (error) {
        if (model.signal.aborted) throw new BeatWriterError('Stopped.');
        // The book changed under the job, or the chapter is gone: nothing the model can fix.
        if (error instanceof ConflictError || error instanceof NotFoundError) throw error;
        reply(`Error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (finished !== null) return finished;
  }
  throw new BeatWriterError(
    lastProblems.length === 0
      ? `The beat writer did not finish in ${MAX_STEPS} steps.`
      : `The beat writer could not satisfy the rules: ${lastProblems.join(' ')}`,
  );
}

/** The keys that mark a JSON object as one tool's arguments, most specific first. */
const TOOL_SHAPES: ReadonlyArray<[BeatToolName, readonly string[]]> = [
  ['accept_action', ['choice', 'beat']],
  ['write_beat', ['title', 'ink']],
  ['write_choices', ['choices']],
  ['decline_action', ['reason']],
  ['propose_variable', ['name', 'meaning']],
  ['read_skill_file', ['name', 'path']],
  ['read_file', ['path']],
  ['activate_skill', ['name']],
  ['search', ['query']],
];

/**
 * A tool's arguments written out as JSON in a reply, as the call they
 * stand for, or none: some models print a call (`Let's read it.{"path": …}`)
 * instead of making it. The call is checked like any other, so a mistake
 * in it goes back to the model to fix.
 */
function callsInText(
  text: string,
  tools: readonly BeatToolName[],
  step: number,
): StreamedToolCall[] {
  // A call printed after planning comes last; an example of the arguments earlier in the plan is not it.
  const json = lastJsonObject(text);
  if (json === undefined) return [];
  // {"name": "write_beat", "arguments": {…}}, the shape of a call itself, names its tool.
  const named = typeof json.name === 'string' && tools.includes(json.name as BeatToolName);
  const args = typeof json.arguments === 'string' ? lastJsonObject(json.arguments) : json.arguments;
  if (named && typeof args === 'object' && args !== null && !Array.isArray(args)) {
    return [
      { id: `text-call-${step}`, name: json.name as string, arguments: JSON.stringify(args) },
    ];
  }
  const shape = TOOL_SHAPES.find(
    ([name, keys]) => tools.includes(name) && keys.every((key) => key in json),
  );
  return shape === undefined
    ? []
    : [{ id: `text-call-${step}`, name: shape[0], arguments: JSON.stringify(json) }];
}

async function runWriting(
  name: BeatToolName,
  raw: string,
  handlers: BeatHandlers,
): Promise<HandlerOutcome> {
  const problems = (error: string): HandlerOutcome => ({ done: false, problems: [error] });
  switch (name) {
    case 'write_beat': {
      const args = parse(writeBeatArgs, raw);
      if (!args.ok) return problems(args.error);
      return handlers.write_beat!(args.value);
    }
    case 'write_choices': {
      const args = parse(writeChoicesArgs, raw);
      if (!args.ok) return problems(args.error);
      return handlers.write_choices!(args.value);
    }
    case 'accept_action': {
      const args = parse(acceptActionArgs, raw);
      if (!args.ok) return problems(args.error);
      return handlers.accept_action!(args.value);
    }
    case 'decline_action': {
      const args = parse(declineActionArgs, raw);
      if (!args.ok) return problems(args.error);
      return handlers.decline_action!(args.value);
    }
    default:
      return problems(`${name} cannot finish the beat.`);
  }
}

/**
 * The review pass: the rules applied by a second request without tools.
 * Its answer is JSON; one that cannot be read passes, since the structural
 * checks have already run and a reviewer's formatting is not the writer's
 * fault.
 */
export async function reviewChoices(model: ModelAccess, prompt: string): Promise<string[]> {
  const request = model.providers.createChatRequest(
    model.config,
    [{ role: 'user', content: prompt }],
    { ...model.controls, thinking: false },
  );
  const { text } = await streamStep(model.providers, model.config, request, model.signal);
  const json = /\{[\s\S]*\}/u.exec(text)?.[0];
  if (json === undefined) return [];
  try {
    const verdict = JSON.parse(json) as { pass?: unknown; problems?: unknown };
    if (verdict.pass !== false) return [];
    return Array.isArray(verdict.problems)
      ? verdict.problems.filter((problem): problem is string => typeof problem === 'string')
      : ['The review found the choices break the rules.'];
  } catch {
    return [];
  }
}
