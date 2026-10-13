import { z } from 'zod';

import { bookFilePathSchema } from './books.js';
import { chapterIdSchema } from './interactive.js';

/**
 * Discovering an interactive book by playing it (ADR 0033): a story setup,
 * choice rules, seed chapters for choices not written yet, and a beat
 * writer that drafts what happens next, on request (co-write) or ahead of
 * the reader (lead).
 */

export const discoverModeSchema = z.enum(['lead', 'cowrite']);

/** How the story is discovered, as `adaptations/interactive/setup.md` records it. */
export const discoverSetupSchema = z.strictObject({
  mode: discoverModeSchema,
  /** Layers of beats written ahead of the reader in lead mode. */
  lookahead: z.union([z.literal(1), z.literal(2)]),
  /** Choices each beat ends with, besides the reader's own "Something else". */
  choices: z.number().int().min(2).max(4),
  beatLength: z.enum(['scene', 'chapter']),
  /** How often branches come back together. */
  rejoin: z.enum(['often', 'sometimes', 'rarely']),
  /** The endings wanted, in the writer's words ("three, one of them bittersweet"). */
  endings: z.string().trim().max(300),
  /** The premise: story-skills' story kernel in story.md. */
  kernel: z.string().trim().max(4000),
  /** Tone, length, and anything else about the shape, in the writer's words. */
  shape: z.string().trim().max(8000),
});

const variableNameSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/u, { message: 'Variable names use letters, digits, and _' })
  .refine((name) => !['true', 'false', 'not', 'and', 'or', 'temp', 'return'].includes(name), {
    message: 'That name is a word ink reserves',
  });

/** An ink value a `VAR` can start with: a number, true or false, or quoted text. */
const variableInitialSchema = z
  .string()
  .trim()
  .regex(/^(?:-?\d+(?:\.\d+)?|true|false|"(?:[^"\\\r\n]|\\.)*")$/u, {
    message: 'Start it as a number, true, false, or "quoted text"',
  });

/** A variable the story tracks, with what it means for the beat writer and the writer. */
export const discoverVariableSchema = z.strictObject({
  name: variableNameSchema,
  initial: variableInitialSchema,
  meaning: z
    .string()
    .trim()
    .max(300)
    .refine((text) => !/[\r\n]/u.test(text), { message: 'Describe it on one line' }),
});

/** A variable the beat writer wants and the writer has not approved yet. */
export const variableProposalSchema = z.strictObject({
  id: z.string(),
  variable: discoverVariableSchema,
  /** Why the beat writer wants it. */
  reason: z.string(),
  /** The beat it was proposed while writing, or null. */
  chapterId: z.string().nullable(),
  createdAt: z.string(),
});

export const saveDiscoverSetupSchema = z.strictObject({
  setup: discoverSetupSchema,
  /** The choice rules as Markdown, as `adaptations/interactive/choice-rules.md` holds them. */
  rules: z.string().trim().min(1).max(20_000),
  variables: z.array(discoverVariableSchema).max(40),
  /**
   * The opening, for a book with no chapters yet: the first scene's prose or
   * ink, or null to have the beat writer draft it from the kernel.
   */
  opening: z.string().max(200_000).nullable().optional(),
});

/** Where a reader is in Play, as its address has it. */
export const playPositionSchema = z.strictObject({
  from: z.string().max(200).nullable(),
  set: z.record(z.string(), z.string().max(200)),
  seed: z.number().int().positive(),
  path: z.array(z.number().int().nonnegative()).max(1000),
});

/** A chapter's place in discovery. */
export const discoverBeatSchema = z.strictObject({
  chapterId: z.string(),
  title: z.string(),
  path: bookFilePathSchema,
  knot: z.string(),
  /** Seeds are choices not written yet; written beats have prose. */
  state: z.enum(['seed', 'written']),
  /** A written beat that ends the story on purpose. */
  ending: z.boolean(),
  /** Whether a reader has reached it in Play. */
  read: z.boolean(),
  /** Whether its ink changed since the beat writer wrote it. */
  edited: z.boolean(),
  /** Whether the chapter it continues changed since it was written. */
  stale: z.boolean(),
  /** The chapter it continues, or null for the opening. */
  from: z.string().nullable(),
  /** For a seed: how it is reached and the writer's note. */
  note: z.string(),
});

/** A seed, with the fewest choices from the start that reach it when play found one. */
export const openThreadSchema = z.strictObject({
  chapterId: z.string(),
  title: z.string(),
  from: z.string().nullable(),
  /** Choice indexes from the start, for Play; null when no path played reaches it. */
  playPath: z.array(z.number().int().nonnegative()).nullable(),
});

/** A proposed beat, not written until the writer picks it. */
export const beatDraftSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  /** The beat's ink, as the chapter would hold it, choices included. */
  ink: z.string(),
  /** What a reader would read, without the ink's markup. */
  prose: z.string(),
  choices: z.array(
    z.strictObject({
      text: z.string(),
      intent: z.string(),
      /** Where it leads, in words: a new beat, an existing chapter, or the end. */
      leads: z.string(),
    }),
  ),
  ending: z.boolean(),
});

export const discoverJobKindSchema = z.enum([
  'beat',
  'choices',
  'rewrite',
  'drafts',
  'something-else',
  'variables',
]);

export const discoverJobSchema = z.strictObject({
  id: z.string(),
  kind: discoverJobKindSchema,
  /** The chapter it writes or continues, or null. */
  chapterId: z.string().nullable(),
  /** What it is doing, for the status line. */
  title: z.string(),
  status: z.enum(['queued', 'running', 'done', 'failed']),
  /** Why it failed, or what the beat writer said. */
  message: z.string().nullable(),
  /** Drafts for a drafts job. */
  drafts: z.array(beatDraftSchema),
  /** For a something-else job: the choice it added, or why it declined. */
  outcome: z
    .discriminatedUnion('accepted', [
      z.strictObject({
        accepted: z.literal(true),
        chapterId: z.string(),
        /** The new choice's index among the chapter's closing choices. */
        choice: z.number().int().nonnegative(),
      }),
      z.strictObject({
        accepted: z.literal(false),
        reason: z.string(),
        suggestion: z.string(),
      }),
    ])
    .nullable(),
  /** Variables proposed by a variables job, for the setup form. */
  variables: z.array(discoverVariableSchema),
  createdAt: z.string(),
});

/** Everything discovery knows about a book. */
export const discoverStateSchema = z.strictObject({
  /** The setup, or null before the writer sets the book up for discovery. */
  setup: discoverSetupSchema.nullable(),
  rules: z.string(),
  variables: z.array(discoverVariableSchema),
  proposals: z.array(variableProposalSchema),
  beats: z.array(discoverBeatSchema),
  openThreads: z.array(openThreadSchema),
  /** Beats written from a chapter that changed since, which the writer read or edited. */
  needsReview: z.array(discoverBeatSchema),
  jobs: z.array(discoverJobSchema),
  /** Whether the configured provider can run the beat writer (it needs tool calling). */
  writerReady: z.boolean(),
  /** Why it cannot, when it cannot. */
  writerProblem: z.string().nullable(),
});

export const discoverPositionInputSchema = z.strictObject({ position: playPositionSchema });

export const draftBeatInputSchema = z.strictObject({
  chapterId: chapterIdSchema,
  position: playPositionSchema.nullable(),
  /** The writer's direction for the drafts ("darker", "Mara lies"). */
  direction: z.string().trim().max(1000).optional(),
});

export const writeBeatInputSchema = z.strictObject({
  chapterId: chapterIdSchema,
  position: playPositionSchema.nullable(),
  direction: z.string().trim().max(1000).optional(),
});

export const somethingElseInputSchema = z.strictObject({
  position: playPositionSchema,
  /** What the reader does, in their own words. */
  action: z.string().trim().min(1).max(500),
});

export const proposeVariablesInputSchema = z.strictObject({
  kernel: z.string().trim().max(4000),
  shape: z.string().trim().max(8000),
});

export const proposalDecisionSchema = z.strictObject({
  approve: z.boolean(),
  /** The variable as the writer edited it, when approving. */
  variable: discoverVariableSchema.optional(),
});

export type DiscoverMode = z.infer<typeof discoverModeSchema>;
export type DiscoverSetup = z.infer<typeof discoverSetupSchema>;
export type DiscoverVariable = z.infer<typeof discoverVariableSchema>;
export type VariableProposal = z.infer<typeof variableProposalSchema>;
export type SaveDiscoverSetupInput = z.infer<typeof saveDiscoverSetupSchema>;
export type PlayPosition = z.infer<typeof playPositionSchema>;
export type DiscoverBeat = z.infer<typeof discoverBeatSchema>;
export type OpenThread = z.infer<typeof openThreadSchema>;
export type BeatDraft = z.infer<typeof beatDraftSchema>;
export type DiscoverJobKind = z.infer<typeof discoverJobKindSchema>;
export type DiscoverJob = z.infer<typeof discoverJobSchema>;
export type DiscoverState = z.infer<typeof discoverStateSchema>;
export type DiscoverPositionInput = z.infer<typeof discoverPositionInputSchema>;
export type DraftBeatInput = z.infer<typeof draftBeatInputSchema>;
export type WriteBeatInput = z.infer<typeof writeBeatInputSchema>;
export type SomethingElseInput = z.infer<typeof somethingElseInputSchema>;
export type ProposeVariablesInput = z.infer<typeof proposeVariablesInputSchema>;
export type ProposalDecision = z.infer<typeof proposalDecisionSchema>;
