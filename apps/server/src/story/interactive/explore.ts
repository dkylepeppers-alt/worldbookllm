import type { PathReport, StoryNode } from '@worldbookllm/shared';
import { Story } from 'inkjs';

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
/** Visit counts above this read alike, so a loop's states repeat instead of growing. */
const VISIT_CAP = 3;

interface Stop {
  /** The story's state at this choice point or ending. */
  state: string;
  /** Choice indexes from the start that reach it. */
  path: number[];
}

type InkStory = InstanceType<typeof Story>;

/**
 * A state's identity for exploring: variables, where the story is, the
 * choices it offers, and how often each knot was visited, capped. Turn
 * counters and output are left out, so a loop back to a state seen before
 * is recognised.
 */
function stateKey(story: InkStory): string {
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
      Math.min(count, VISIT_CAP),
    ]),
  );
  const flows = Object.fromEntries(
    Object.entries(state.flows ?? {}).map(([name, flow]) => [
      name,
      {
        // Thread indexes and the thread counter grow every time round a
        // loop; only the frames and where each thread was say where it is.
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
  return JSON.stringify([state.variablesState, visits, flows]);
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
export function explorePaths(json: string, nodes: readonly StoryNode[]): PathReport {
  const started = Date.now();
  const names = nodes.filter((node) => node.kind !== 'function').map((node) => node.name);
  const reached = new Set<string>();
  const offered = new Set<string>();
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

  /** Runs to the next stop; false when it stopped on an error. */
  const run = (path: number[]): boolean => {
    failure = null;
    try {
      while (story.canContinue) story.Continue();
    } catch (error) {
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
  story.state.LoadJson(initial);
  if (run([])) queue.push({ state: story.state.toJson(), path: [] });

  while (queue.length > 0) {
    if (explored >= STATE_BUDGET || Date.now() - started > TIME_BUDGET_MS) {
      complete = false;
      break;
    }
    const stop = queue.shift()!;
    story.state.LoadJson(stop.state);
    const key = stateKey(story);
    if (seen.has(key)) continue;
    seen.add(key);
    explored += 1;
    const choices = story.currentChoices.map((choice: { text: string; sourcePath: string }) => ({
      text: choice.text,
      source: choice.sourcePath,
    }));
    for (const choice of choices) offered.add(`${choice.source.split('.')[0]}\0${choice.text}`);
    if (choices.length === 0) {
      endings.push(stop.path.length);
      continue;
    }
    choices.forEach((_choice: unknown, index: number) => {
      story.state.LoadJson(stop.state);
      story.ChooseChoiceIndex(index);
      const path = [...stop.path, index];
      if (run(path)) queue.push({ state: story.state.toJson(), path });
    });
  }

  const never = nodes.flatMap((node) =>
    node.kind === 'function'
      ? []
      : node.choices
          .filter((choice) => !offered.has(`${node.name.split('.')[0]}\0${choice.text}`))
          .map((choice) => ({
            node: node.name,
            text: choice.text,
            line: choice.line,
            path: node.path,
          })),
  );
  return {
    complete,
    explored,
    endings: endings.length,
    shortest: endings.length === 0 ? null : Math.min(...endings),
    longest: endings.length === 0 ? null : Math.max(...endings),
    unreached: nodes
      .filter((node) => node.kind !== 'function' && !reached.has(node.name))
      .map((node) => ({ node: node.name, title: node.title, path: node.path, line: node.line })),
    neverOffered: never,
    errors: [...errors].map(([message, path]) => ({ message, path })),
  };
}
