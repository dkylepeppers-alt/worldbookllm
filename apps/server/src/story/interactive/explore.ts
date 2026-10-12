import type { PathReport, StoryChoice } from '@worldbookllm/shared';
import { Story } from 'inkjs';

import type { StoryStructure } from './structure.js';

/**
 * Plays an interactive book's compiled story down every path it allows
 * (ADR 0032): breadth first from the start, every choice at every stop,
 * until each distinct state has been seen or the budget runs out. What it
 * finds is what playing can show and reading the source cannot: runtime
 * errors (running out of story, a divert that fails) with the choices that
 * reach them, endings and how far they are, and knots, stitches, and
 * choices no path reaches.
 */

/** States to explore before stopping; enough for most books in well under a second. */
const STATE_BUDGET = 3_000;
/** Wall-clock budget, so a vast story never holds the server. */
const TIME_BUDGET_MS = 2_000;
/** Visit counts are kept exactly up to at least this. */
const MIN_VISIT_CAP = 3;
/** And at most this, so a loop's states still repeat. */
const MAX_VISIT_CAP = 100;

interface Stop {
  /** The story's state at this choice point or ending. */
  state: string;
  /** Choice indexes from the start that reach it. */
  path: number[];
}

type InkStory = InstanceType<typeof Story>;

/** Thrown when the time budget runs out partway through a passage. */
class OutOfTime extends Error {}

/**
 * The visit count above which counts read alike. The story can only tell
 * counts apart by comparing them with the numbers it is written with (a
 * condition such as `{cellar > 4}`, a sequence's length), so counts above
 * the largest of those, plus one, behave the same; capping there lets a
 * loop's states repeat without merging states the story treats differently.
 */
function visitCapOf(json: string): number {
  let largest = 0;
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'number' && Number.isInteger(item)) {
          largest = Math.max(largest, Math.abs(item));
        } else walk(item);
      }
    } else if (value !== null && typeof value === 'object') {
      // Container flags (`#f`) are numbers too, but not ones the story compares.
      for (const [key, item] of Object.entries(value)) if (key !== '#f') walk(item);
    }
  };
  walk((JSON.parse(json) as { root?: unknown }).root);
  return Math.min(Math.max(largest + 1, MIN_VISIT_CAP), MAX_VISIT_CAP);
}

/**
 * A state's identity for exploring: variables, the random generator, where
 * the story is, the choices it offers, and how often each knot was
 * visited, capped. Turn counters, output, thread indexes and the thread
 * counter grow every time round a loop and are left out, so a loop back to
 * a state seen before is recognised.
 */
function stateKey(story: InkStory, visitCap: number): string {
  const state = JSON.parse(story.state.toJson()) as {
    variablesState?: unknown;
    visitCounts?: Record<string, number>;
    flows?: Record<
      string,
      {
        callstack?: { threads?: Array<{ callstack?: unknown; previousContentObject?: unknown }> };
        currentChoices?: Array<{ originalChoicePath?: string; text?: string }>;
      }
    >;
  };
  const visits = Object.fromEntries(
    Object.entries(state.visitCounts ?? {}).map(([path, count]) => [
      path,
      Math.min(count, visitCap),
    ]),
  );
  const flows = Object.fromEntries(
    Object.entries(state.flows ?? {}).map(([name, flow]) => [
      name,
      {
        threads: (flow.callstack?.threads ?? []).map((thread) => [
          thread.callstack,
          thread.previousContentObject,
        ]),
        choices: (flow.currentChoices ?? []).map((choice) => [
          choice.originalChoicePath,
          choice.text,
        ]),
      },
    ]),
  );
  // The same state after a different number of RANDOM() calls plays on differently.
  const random = [story.state.storySeed, story.state.previousRandom];
  return JSON.stringify([state.variablesState, visits, flows, random]);
}

/** Every knot and stitch visited so far: those with a visit count. */
function visited(story: InkStory, names: readonly string[], into: Set<string>): void {
  for (const name of names) {
    if (into.has(name)) continue;
    try {
      if ((story.state.VisitCountAtPathString(name) ?? 0) > 0) into.add(name);
    } catch {
      // A name the runtime does not know; nothing to count.
    }
  }
}

/** Explores the story and reports what playing it shows. */
export function explorePaths(
  json: string,
  structure: Pick<StoryStructure, 'nodes' | 'choiceSources'>,
): PathReport {
  const deadline = Date.now() + TIME_BUDGET_MS;
  const { nodes, choiceSources } = structure;
  const visitCap = visitCapOf(json);
  const names = nodes.filter((node) => node.kind !== 'function').map((node) => node.name);
  const reached = new Set<string>();
  // Runtime source paths of the choices offered, and (for choices whose
  // source is unknown) their knot and text.
  const offered = new Set<string>();
  const offeredText = new Set<string>();
  const errors = new Map<string, number[]>();
  const endings: number[] = [];
  const seen = new Set<string>();
  let explored = 0;
  let complete = true;

  const story = new Story(json);
  // Seed 1, as Play and ink_play default to, so a path found here replays there.
  story.state.storySeed = 1;
  let failure: string | null = null;
  story.onError = (message: string, type: number) => {
    // ErrorType: 0 author note, 1 warning, 2 error.
    if (type === 2 && failure === null) failure = message.replace(/^RUNTIME ERROR:\s*/u, '');
  };
  const initial = story.state.toJson();

  /** Runs to the next stop; false when it stopped on an error. Throws OutOfTime. */
  const run = (path: number[]): boolean => {
    failure = null;
    try {
      while (story.canContinue) {
        // A passage can loop without ever offering a choice; the budget holds inside it too.
        if (Date.now() > deadline) throw new OutOfTime();
        story.Continue();
      }
    } catch (error) {
      if (error instanceof OutOfTime) throw error;
      failure ??= error instanceof Error ? error.message : String(error);
    }
    visited(story, names, reached);
    if (failure !== null) {
      if (!errors.has(failure)) errors.set(failure, path);
      return false;
    }
    return true;
  };

  const queue: Stop[] = [];
  try {
    story.state.LoadJson(initial);
    if (run([])) queue.push({ state: story.state.toJson(), path: [] });

    while (queue.length > 0) {
      if (explored >= STATE_BUDGET || Date.now() > deadline) throw new OutOfTime();
      const stop = queue.shift()!;
      story.state.LoadJson(stop.state);
      const key = stateKey(story, visitCap);
      if (seen.has(key)) continue;
      seen.add(key);
      explored += 1;
      const choices = story.currentChoices as Array<{ text: string; sourcePath: string }>;
      for (const choice of choices) {
        offered.add(choice.sourcePath);
        offeredText.add(`${choice.sourcePath.split('.')[0]}\0${choice.text}`);
      }
      if (choices.length === 0) {
        endings.push(stop.path.length);
        continue;
      }
      for (let index = 0; index < choices.length; index += 1) {
        story.state.LoadJson(stop.state);
        story.ChooseChoiceIndex(index);
        const path = [...stop.path, index];
        if (run(path)) queue.push({ state: story.state.toJson(), path });
      }
    }
  } catch (error) {
    if (!(error instanceof OutOfTime)) throw error;
    complete = false;
  }

  const wasOffered = (node: string, choice: StoryChoice) => {
    const source = choiceSources.get(choice);
    return source === undefined
      ? offeredText.has(`${node.split('.')[0]}\0${choice.text}`)
      : offered.has(source);
  };
  return {
    complete,
    explored,
    endings: endings.length,
    shortest: endings.length === 0 ? null : Math.min(...endings),
    longest: endings.length === 0 ? null : Math.max(...endings),
    unreached: nodes
      .filter((node) => node.kind !== 'function' && !reached.has(node.name))
      .map((node) => ({ node: node.name, title: node.title, path: node.path, line: node.line })),
    neverOffered: nodes.flatMap((node) =>
      node.kind === 'function'
        ? []
        : node.choices
            .filter((choice) => !wasOffered(node.name, choice))
            .map((choice) => ({
              node: node.name,
              text: choice.text,
              line: choice.line,
              path: node.path,
            })),
    ),
    errors: [...errors].map(([message, path]) => ({ message, path })),
  };
}
