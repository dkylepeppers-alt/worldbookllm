import type { ChatMessage, ToolDefinition } from '@worldbookllm/providers';
import type { AgentGeneration, ProviderConfig } from '@worldbookllm/shared';
import type { z } from 'zod';

import { ConflictError, NotFoundError } from '../../errors.js';
import type { ProviderService } from '../../services/providers.js';
import { providerToolArguments, streamStep } from '../provider-step.js';
import {
  BEAT_TOOLS,
  acceptActionArgs,
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
  const tools = [...input.tools, 'read_file', 'search', 'propose_variable'] as BeatToolName[];
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
    const { text, calls } = await streamStep(model.providers, model.config, request, model.signal);
    if (calls.length === 0) {
      nudges += 1;
      if (nudges > 2) throw new BeatWriterError('The model answered without writing the beat.');
      messages.push({ role: 'assistant', content: text });
      messages.push({
        role: 'user',
        content: `Finish by calling ${input.tools.join(' or ')}; do not answer in prose.`,
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
