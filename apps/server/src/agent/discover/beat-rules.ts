import { z } from 'zod';

import type { BeatChoice, BeatProposal } from '../../story/interactive/discover.js';

/**
 * The beat writer's tools and the structural rules a beat's choices must
 * pass before anything is written (ADR 0033). The rules the model is asked
 * to judge (intent, character, what is possible in the scene) are checked by
 * the review pass; these are the ones code can check.
 */

const line = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((text) => !/[\r\n]/u.test(text), { message: 'one line' });

const choiceArgs = z.object({
  text: line(120).pipe(z.string().min(1)),
  intent: line(300).default(''),
  consequence: line(300).default(''),
  condition: line(300).default(''),
  effects: z.array(line(200)).max(8).default([]),
  leads_to: z.enum(['new', 'existing', 'end']),
  /** For `existing`: the chapter id it rejoins. */
  chapter: z.string().trim().max(100).optional(),
  /** For `new`: where the new beat should go, for whoever writes it. */
  note: line(500).default(''),
});

export const writeBeatArgs = z.object({
  title: line(80).pipe(z.string().min(1)),
  summary: line(500).default(''),
  ink: z.string().max(60_000),
  ending: z.boolean().default(false),
  choices: z.array(choiceArgs).max(6).default([]),
});

export const writeChoicesArgs = z.object({
  choices: z.array(choiceArgs).min(1).max(6),
});

export const acceptActionArgs = z.object({
  choice: choiceArgs.omit({ leads_to: true, chapter: true, note: true }),
  beat: writeBeatArgs,
});

export const declineActionArgs = z.object({
  reason: line(500).pipe(z.string().min(1)),
  suggestion: line(300).default(''),
});

export const proposeVariableArgs = z.object({
  name: z
    .string()
    .trim()
    .regex(/^[A-Za-z_]\w*$/u),
  initial: z.string().trim().max(200),
  meaning: line(300).pipe(z.string().min(1)),
  reason: line(500).default(''),
});

export const readFileArgs = z.object({ path: z.string().trim().min(1).max(1024) });
export const searchArgs = z.object({ query: z.string().trim().min(1).max(200) });

type ChoiceArgs = z.infer<typeof choiceArgs>;

const choiceParameters = {
  type: 'object',
  additionalProperties: false,
  required: ['text', 'intent', 'consequence', 'leads_to'],
  properties: {
    text: {
      type: 'string',
      description: 'What the reader picks, in the book voice. One line, no brackets.',
    },
    intent: {
      type: 'string',
      description: 'The approach this choice takes, in a few words (confront, deceive, wait…).',
    },
    consequence: {
      type: 'string',
      description: 'What it changes: where it leads, what it sets, what it costs.',
    },
    condition: {
      type: 'string',
      description:
        'Optional ink condition without braces, e.g. trust > 1. Only declared variables.',
    },
    effects: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Optional ink assignments without ~, e.g. "trust -= 1". Only declared variables.',
    },
    leads_to: {
      type: 'string',
      enum: ['new', 'existing', 'end'],
      description:
        'new: a new beat (a seed someone writes later); existing: rejoin a chapter that exists; end: the story ends.',
    },
    chapter: {
      type: 'string',
      description: 'For existing: the chapter id to rejoin, e.g. chapter-04.',
    },
    note: { type: 'string', description: 'For new: one line on where the new beat should go.' },
  },
} as const;

const beatProperties = {
  title: { type: 'string', description: "The beat's title, a few words." },
  summary: { type: 'string', description: 'One sentence on what happens in the beat.' },
  ink: {
    type: 'string',
    description:
      'The beat as ink: prose lines (each line a paragraph), conditional text and in-scene weaves allowed. Do NOT include the closing choices or a final divert; they come from choices.',
  },
  ending: {
    type: 'boolean',
    description: 'True when this beat ends the story; then choices is empty.',
  },
  choices: { type: 'array', items: choiceParameters },
} as const;

/** Tool definitions in the shape the providers package sends. */
export const BEAT_TOOLS = {
  write_beat: {
    description:
      'Write the beat: its prose as ink and the choices it ends with. Checked against the rules before anything is written; fix what it reports and call it again.',
    parameters: {
      required: ['title', 'summary', 'ink', 'ending', 'choices'],
      properties: beatProperties,
    },
  },
  write_choices: {
    description:
      "Write the closing choices for a beat whose prose already exists. Checked like write_beat's choices.",
    parameters: {
      required: ['choices'],
      properties: { choices: { type: 'array', items: choiceParameters } },
    },
  },
  accept_action: {
    description:
      "The reader's own action works here: add it as a choice (rewritten in the book's voice) and write the beat it leads to.",
    parameters: {
      required: ['choice', 'beat'],
      properties: {
        choice: {
          type: 'object',
          additionalProperties: false,
          required: ['text', 'intent', 'consequence'],
          properties: {
            text: choiceParameters.properties.text,
            intent: choiceParameters.properties.intent,
            consequence: choiceParameters.properties.consequence,
            condition: choiceParameters.properties.condition,
            effects: choiceParameters.properties.effects,
          },
        },
        beat: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'summary', 'ink', 'ending', 'choices'],
          properties: beatProperties,
        },
      },
    },
  },
  decline_action: {
    description:
      "The reader's action cannot happen here (impossible in the scene, out of character, or beyond what they know). Say why, and suggest the nearest action that would work.",
    parameters: {
      required: ['reason', 'suggestion'],
      properties: {
        reason: { type: 'string' },
        suggestion: {
          type: 'string',
          description: 'The nearest action that would work, as choice text.',
        },
      },
    },
  },
  propose_variable: {
    description:
      'Ask the writer for a new story variable. It is not declared until they approve it, so do not use it in this beat.',
    parameters: {
      required: ['name', 'initial', 'meaning', 'reason'],
      properties: {
        name: { type: 'string' },
        initial: { type: 'string', description: 'A number, true, false, or "quoted text".' },
        meaning: { type: 'string', description: 'One line: what it tracks and what it affects.' },
        reason: { type: 'string', description: 'Why the story needs it.' },
      },
    },
  },
  read_file: {
    description: 'Read a book file (a bible entry, a chapter) by its path.',
    parameters: { required: ['path'], properties: { path: { type: 'string' } } },
  },
  search: {
    description: "Search the book's files for a word or phrase.",
    parameters: { required: ['query'], properties: { query: { type: 'string' } } },
  },
} as const;

export type BeatToolName = keyof typeof BEAT_TOOLS;

export function choiceFromArgs(args: ChoiceArgs): BeatChoice {
  return {
    text: args.text,
    intent: args.intent,
    consequence: args.consequence,
    condition: args.condition,
    effects: args.effects.filter((effect) => effect !== ''),
    to:
      args.leads_to === 'new'
        ? { kind: 'new', note: args.note }
        : args.leads_to === 'end'
          ? { kind: 'end' }
          : { kind: 'existing', chapterId: (args.chapter ?? '').trim() },
  };
}

export function proposalFromArgs(args: z.infer<typeof writeBeatArgs>): BeatProposal {
  return {
    title: args.title,
    summary: args.summary,
    ink: args.ink,
    ending: args.ending,
    choices: args.ending ? [] : args.choices.map(choiceFromArgs),
  };
}

/** What the structural checks need to know about the book. */
export interface ChoiceCheckContext {
  /** Choices each beat ends with. */
  count: number;
  /** Declared variables. */
  variables: ReadonlySet<string>;
  /** Chapter ids a choice may rejoin. */
  chapters: ReadonlySet<string>;
  /** Knot names a condition may test (visit counts). */
  knots: ReadonlySet<string>;
  /** The chapter the choices belong to, which they may not lead back to. */
  self: string;
  /** For a rewrite: the targets the choices must keep, as `existing:id`, `new` is not allowed. */
  keepTargets?: readonly string[];
}

const KEYWORDS = new Set(['and', 'or', 'not', 'true', 'false', 'mod', 'has', 'hasnt', 'temp']);
// Words too common to make two choices alike.
const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'you',
  'your',
  'her',
  'his',
  'him',
  'them',
  'their',
  'into',
  'from',
  'that',
  'this',
  'what',
  'about',
  'are',
  'was',
  'its',
  'out',
  'off',
  'onto',
  'over',
]);
const ASSIGNMENT = /^\s*([A-Za-z_]\w*)\s*(=|\+=|-=|\+\+|--)\s*(.*)$/u;

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/u)
      .filter((word) => word.length > 2 && !STOP_WORDS.has(word)),
  );
}

/** How alike two choices' words are, from 0 to 1. */
function overlap(left: string, right: string): number {
  const a = words(left);
  const b = words(right);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

function targetKey(choice: BeatChoice): string {
  if (choice.to.kind === 'new') return `new:${choice.text}`;
  if (choice.to.kind === 'end') return 'end';
  return `existing:${choice.to.chapterId}`;
}

function identifiers(expression: string): string[] {
  return [...expression.replace(/"(?:[^"\\]|\\.)*"/gu, '').matchAll(/[A-Za-z_][\w.]*/gu)]
    .map((match) => match[0])
    .filter((name) => !KEYWORDS.has(name));
}

/** The problems with a set of choices that code can find, as sentences for the model. */
export function checkChoices(
  choices: readonly BeatChoice[],
  context: ChoiceCheckContext,
): string[] {
  const problems: string[] = [];
  if (choices.length !== context.count) {
    problems.push(
      `Write exactly ${context.count} choices (you wrote ${choices.length}), or set ending to true for an ending.`,
    );
  }
  const seen = new Map<string, string>();
  choices.forEach((choice, index) => {
    const label = `Choice ${index + 1} ("${choice.text}")`;
    if (/[[\]]/u.test(choice.text)) problems.push(`${label}: leave brackets out of the text.`);
    const normal = [...words(choice.text)].sort().join(' ');
    const twin = seen.get(normal);
    if (twin !== undefined) problems.push(`${label} says the same as "${twin}".`);
    else seen.set(normal, choice.text);
    choices.slice(index + 1).forEach((other) => {
      if (
        overlap(choice.text, other.text) >= 0.75 &&
        normal !== [...words(other.text)].sort().join(' ')
      ) {
        problems.push(
          `"${choice.text}" and "${other.text}" are nearly the same action; make them different intents.`,
        );
      }
    });
    if (choice.intent.trim() === '') problems.push(`${label}: say its intent.`);
    if (choice.consequence.trim() === '') problems.push(`${label}: say its consequence.`);
    for (const effect of choice.effects) {
      const match = ASSIGNMENT.exec(effect);
      if (match === null) {
        problems.push(`${label}: "${effect}" is not an assignment such as trust -= 1.`);
      } else if (!context.variables.has(match[1]!)) {
        problems.push(
          `${label}: ${match[1]} is not a declared variable. Use one that is, or propose it with propose_variable and leave it out of this beat.`,
        );
      }
    }
    for (const name of identifiers(choice.condition)) {
      if (!context.variables.has(name) && !context.knots.has(name.split('.')[0]!)) {
        problems.push(
          `${label}: its condition reads ${name}, which is neither a declared variable nor a knot.`,
        );
      }
    }
    if (choice.to.kind === 'existing') {
      if (choice.to.chapterId === context.self) {
        problems.push(`${label} leads back to this same beat; lead somewhere else.`);
      } else if (!context.chapters.has(choice.to.chapterId)) {
        problems.push(
          `${label} rejoins ${choice.to.chapterId || '(no chapter)'}, which is not a chapter in this book.`,
        );
      }
    }
  });
  // A false choice: two choices that go to the same place and change the same things.
  for (let left = 0; left < choices.length; left += 1) {
    for (let right = left + 1; right < choices.length; right += 1) {
      const a = choices[left]!;
      const b = choices[right]!;
      const same =
        targetKey(a) === targetKey(b) &&
        [...a.effects].sort().join(';') === [...b.effects].sort().join(';');
      if (same) {
        problems.push(
          `"${a.text}" and "${b.text}" lead to the same place and change the same things, so the choice does not matter. Lead them apart or make them set different state.`,
        );
      }
    }
  }
  if (context.keepTargets !== undefined) {
    const wanted = [...context.keepTargets].sort().join(',');
    const got = choices
      .map((choice) => targetKey(choice))
      .sort()
      .join(',');
    if (wanted !== got) {
      problems.push(
        `Keep the beat's choices leading where they lead now (${context.keepTargets.join(', ')}); the beats after them are already written.`,
      );
    }
  }
  return problems;
}

/** The problems with a beat that code can find. */
export function checkBeat(proposal: BeatProposal, context: ChoiceCheckContext): string[] {
  const problems: string[] = [];
  if (proposal.ink.trim() === '') problems.push('Write the beat itself in ink.');
  const lines = proposal.ink.replace(/\r\n?/gu, '\n').split('\n');
  const last =
    lines
      .filter((entry) => entry.trim() !== '')
      .at(-1)
      ?.trim() ?? '';
  if (/^->/u.test(last)) {
    problems.push(
      'Leave the final divert out of ink; the choices (or ending) decide where the beat goes.',
    );
  }
  if (/^\s*={2,}/mu.test(proposal.ink)) {
    problems.push('Leave knot lines (=== name ===) out; worldbookllm adds the knot.');
  }
  if (proposal.ending) {
    if (proposal.choices.length > 0) problems.push('An ending has no choices.');
    return problems;
  }
  return [...problems, ...checkChoices(proposal.choices, context)];
}

/** One line per choice, for the review pass and the drafts. */
export function describeChoices(
  choices: readonly BeatChoice[],
  titleOf: (id: string) => string | undefined,
): string {
  return choices
    .map((choice, index) => {
      const leads =
        choice.to.kind === 'new'
          ? `a new beat${choice.to.note.trim() === '' ? '' : ` (${choice.to.note.trim()})`}`
          : choice.to.kind === 'end'
            ? 'the end'
            : `rejoins "${titleOf(choice.to.chapterId) ?? choice.to.chapterId}"`;
      const state = [
        choice.condition.trim() === '' ? '' : `offered when ${choice.condition.trim()}`,
        choice.effects.length === 0 ? '' : `sets ${choice.effects.join(', ')}`,
      ].filter((part) => part !== '');
      return `${index + 1}. "${choice.text}" — intent: ${choice.intent}; consequence: ${choice.consequence}; leads to ${leads}${state.length === 0 ? '' : `; ${state.join('; ')}`}`;
    })
    .join('\n');
}
