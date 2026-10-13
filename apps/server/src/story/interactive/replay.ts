import type { PlayPosition } from '@worldbookllm/shared';
import { Story } from 'inkjs';

/**
 * Replays a reader's place in Play on the server (ADR 0033), as the Play
 * screen does in the browser: the same seed, the same variables set first,
 * the same start, and the same choices, with each line grouped under the
 * chapter knot it comes from. Discovery uses it to know where the reader is,
 * what they read on the way, and what the story's state is there.
 */

type InkStory = InstanceType<typeof Story>;

export interface ReplayKnot {
  knot: string;
  chapterId: string;
  title: string;
}

interface ReplaySegment {
  chapterId: string | null;
  title: string | null;
  lines: string[];
  /** The choice taken just before this segment's lines, if one was. */
  after: string | null;
}

export interface ReplayedPosition {
  segments: ReplaySegment[];
  /** The text of each choice taken, in order. */
  chosen: string[];
  /** Chapters entered on the way, in the order first entered. */
  visited: string[];
  /** The chapter the reader is in now, or null before the first. */
  current: string | null;
  /** The choices offered now; none at an ending. */
  choices: Array<{ text: string; sourcePath: string }>;
  variables: Array<{ name: string; value: string }>;
  /** Whether the path asked for a choice the story no longer offers. */
  stale: boolean;
}

function visitCounts(story: InkStory, knots: readonly ReplayKnot[]): number[] {
  return knots.map((entry) => {
    try {
      return story.state.VisitCountAtPathString(entry.knot) ?? 0;
    } catch {
      return 0;
    }
  });
}

function inkValue(text: string): boolean | number | string {
  if (text === 'true' || text === 'false') return text === 'true';
  const number = Number(text);
  return text.trim() !== '' && Number.isFinite(number) ? number : text;
}

function describe(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return JSON.stringify(value);
  return String(value);
}

/** Lines until the next choice, by chapter; a knot diverting to itself starts it again. */
function runToChoice(
  story: InkStory,
  knots: readonly ReplayKnot[],
  current: ReplayKnot | null,
  from: number[],
): Array<{ knot: ReplayKnot | null; lines: string[] }> {
  const segments: Array<{ knot: ReplayKnot | null; lines: string[] }> = [];
  let before = from;
  while (story.canContinue) {
    const line = story.Continue()?.trim() ?? '';
    const tags: string[] = story.currentTags ?? [];
    const after = visitCounts(story, knots);
    let entered = false;
    knots.forEach((entry, index) => {
      if (after[index]! > before[index]!) {
        segments.push({ knot: entry, lines: [] });
        entered = true;
      }
    });
    before = after;
    if (!entered && tags.some((tag) => /^chapter\s*:/u.test(tag))) {
      const knot =
        [...segments].reverse().find((segment) => segment.knot !== null)?.knot ?? current;
      if (knot !== null) segments.push({ knot, lines: [] });
    }
    if (segments.length === 0) segments.push({ knot: null, lines: [] });
    if (tags.some((tag) => /^break\s*$/u.test(tag.trim()))) segments.at(-1)!.lines.push('* * *');
    if (line !== '') segments.at(-1)!.lines.push(line);
  }
  return segments;
}

/** Plays `json` to `position`. Throws when the story errors on the way. */
export function replayPosition(
  json: string,
  knots: readonly ReplayKnot[],
  variables: readonly string[],
  position: PlayPosition,
): ReplayedPosition {
  const story = new Story(json);
  story.state.storySeed = position.seed;
  let failure: string | null = null;
  story.onError = (message: string, type: number) => {
    if (type === 2 && failure === null) failure = message;
  };
  for (const [name, value] of Object.entries(position.set)) {
    if (variables.includes(name)) story.variablesState.$(name, inkValue(value));
  }
  const initial = visitCounts(story, knots);
  if (position.from !== null) story.ChoosePathString(position.from);
  const all: Array<{ knot: ReplayKnot | null; lines: string[]; after: string | null }> = [];
  let segments = runToChoice(story, knots, null, initial);
  all.push(...segments.map((segment) => ({ ...segment, after: null })));
  const chosen: string[] = [];
  let current: ReplayKnot | null = null;
  let stale = false;
  for (const index of position.path) {
    const choice = story.currentChoices[index];
    if (choice === undefined) {
      stale = true;
      break;
    }
    chosen.push(choice.text);
    story.ChooseChoiceIndex(index);
    current = [...segments].reverse().find((segment) => segment.knot !== null)?.knot ?? current;
    segments = runToChoice(story, knots, current, visitCounts(story, knots));
    // A choice that prints nothing still shows where it was taken.
    if (segments.length === 0) segments.push({ knot: current, lines: [] });
    all.push(
      ...segments.map((segment, at) => ({ ...segment, after: at === 0 ? choice.text : null })),
    );
  }
  if (failure !== null) throw new Error(failure);
  const last = [...all].reverse().find((segment) => segment.knot !== null)?.knot ?? null;
  const visited: string[] = [];
  for (const segment of all) {
    const id = segment.knot?.chapterId;
    if (id !== undefined && !visited.includes(id)) visited.push(id);
  }
  return {
    segments: all.map((segment) => ({
      chapterId: segment.knot?.chapterId ?? null,
      title: segment.knot?.title ?? null,
      lines: segment.lines,
      after: segment.after,
    })),
    chosen,
    visited,
    current: last?.chapterId ?? null,
    choices: (story.currentChoices as Array<{ text: string; sourcePath: string }>).map(
      (choice) => ({ text: choice.text, sourcePath: choice.sourcePath }),
    ),
    variables: variables.map((name) => ({
      name,
      value: describe(story.variablesState.$(name)),
    })),
    stale,
  };
}

/**
 * The transcript as the beat writer reads it: each chapter's lines under its
 * title, with each choice taken where it was taken. A long one keeps its end.
 */
export function transcriptText(replayed: ReplayedPosition, maxChars = 24_000): string {
  const parts: string[] = [];
  let previous: string | null | undefined;
  for (const segment of replayed.segments) {
    if (segment.after !== null) parts.push(`> The reader chose: ${segment.after}`);
    if (segment.chapterId !== previous && segment.title !== null) parts.push(`## ${segment.title}`);
    previous = segment.chapterId;
    parts.push(...segment.lines);
  }
  const text = parts.join('\n\n');
  return text.length <= maxChars ? text : `[…earlier text left out…]\n\n${text.slice(-maxChars)}`;
}
