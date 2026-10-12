import { z } from 'zod';

import { bookFilePathSchema, bookSlugSchema, sha256Schema } from './books.js';

/**
 * Interactive books written in ink (ADR 0030): each chapter file is one knot
 * whose body is ink, global ink lives in `ink/*.md`, and worldbookllm
 * assembles, compiles, and reads the story itself.
 */

/** Words ink reserves, which a knot cannot be named. */
const INK_RESERVED = new Set(['true', 'false', 'not', 'else', 'return', 'temp', 'function']);

/**
 * A chapter id's knot name: `-` becomes `_`, and a name that starts with a
 * digit or is a reserved word takes a leading `_` (`chapter-03` is
 * `chapter_03`, `1-prologue` is `_1_prologue`).
 */
export function inkKnotName(id: string): string {
  const name = id.replace(/-/gu, '_');
  return /^[0-9]/u.test(name) || INK_RESERVED.has(name) ? `_${name}` : name;
}

export const chapterIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, {
  message: 'Chapter ids use lowercase letters, numbers, and single hyphens',
});

export const chapterParamsSchema = z.strictObject({
  book: bookSlugSchema,
  id: chapterIdSchema,
});

/** What the ink compiler or worldbookllm's checks said, at a place in a book file. */
export const inkDiagnosticSchema = z.strictObject({
  severity: z.enum(['error', 'warning', 'todo']),
  message: z.string(),
  /** The book file it concerns, or null for the story as a whole. */
  path: bookFilePathSchema.nullable(),
  /** 1-based line in that file, or null. */
  line: z.number().int().positive().nullable(),
});

/** A choice as the compiled story has it. */
export const storyChoiceSchema = z.strictObject({
  /** What the reader picks, as written (choice-only text included). */
  text: z.string(),
  /** `*` choices are offered once; `+` choices every time. */
  once: z.boolean(),
  /** The condition before the text, as written, without braces; null when always offered. */
  condition: z.string().nullable(),
  /** Where it diverts to directly: a knot or `knot.stitch`, `END`, `DONE`, or null if it flows on. */
  target: z.string().nullable(),
  /** Variables its own lines change. */
  writes: z.array(z.string()),
  line: z.number().int().positive().nullable(),
});

/** A knot or stitch: a chapter, a stitch inside one, or ink from `ink/`. */
export const storyNodeSchema = z.strictObject({
  /** Its ink path: `chapter_03` or `chapter_03.cellar`. */
  name: z.string(),
  kind: z.enum(['chapter', 'stitch', 'knot', 'function']),
  /** The chapter it belongs to (its own, or its knot's for a stitch); null for `ink/` knots. */
  chapterId: z.string().nullable(),
  title: z.string(),
  path: bookFilePathSchema.nullable(),
  line: z.number().int().positive().nullable(),
  choices: z.array(storyChoiceSchema),
  /** Diverts outside choices, tunnels and threads included. */
  diverts: z.array(
    z.strictObject({
      target: z.string(),
      kind: z.enum(['divert', 'tunnel', 'thread']),
      line: z.number().int().positive().nullable(),
    }),
  ),
  /** Whether it can end the story (`-> END`). */
  ends: z.boolean(),
  reads: z.array(z.string()),
  writes: z.array(z.string()),
  words: z.number().int().nonnegative(),
  /** Whether a divert or choice from the start can lead here. */
  reachable: z.boolean(),
});

export const storyVariableSchema = z.strictObject({
  name: z.string(),
  kind: z.enum(['var', 'const', 'list']),
  /** Its initial value as written. */
  initial: z.string(),
  path: bookFilePathSchema.nullable(),
  line: z.number().int().positive().nullable(),
});

/** A chapter of an interactive book, as its file is now. */
export const storyChapterSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  path: bookFilePathSchema,
  hash: sha256Schema,
  /** The knot name writers divert to. */
  knot: z.string(),
});

/** The book's ink story: its chapters, structure, and what the compiler said. */
export const interactiveStorySchema = z.strictObject({
  title: z.string(),
  /** story.md's IFID, or null when it has none (or one that is not a version 4 UUID). */
  ifid: z.string().nullable(),
  chapters: z.array(storyChapterSchema),
  /** Whether it compiled; when not, `nodes` and `variables` are empty. */
  compiled: z.boolean(),
  /** Where the story starts: a knot or `knot.stitch`. */
  start: z.string().nullable(),
  nodes: z.array(storyNodeSchema),
  variables: z.array(storyVariableSchema),
  diagnostics: z.array(inkDiagnosticSchema),
});

/** A chapter's knot in the compiled story, for the Play screen's headings. */
export const playKnotSchema = z.strictObject({
  knot: z.string(),
  chapterId: z.string(),
  title: z.string(),
});

/** The story compiled for the Play screen to run with inkle's runtime. */
export const bookPlaySchema = z.strictObject({
  title: z.string(),
  ifid: z.string().nullable(),
  /** The whole story as one ink file, as the `.ink` export writes it. */
  source: z.string(),
  /** That story compiled by inkjs to ink's JSON format. */
  story: z.string(),
  knots: z.array(playKnotSchema),
  /** Knots and stitches the Play screen can jump to. */
  paths: z.array(z.string()),
  /** Global variables, in declaration order. */
  variables: z.array(z.strictObject({ name: z.string(), kind: z.enum(['var', 'const', 'list']) })),
  /** What the compiler warned about, and TODOs. */
  warnings: z.array(z.string()),
});

/** The ink for a choice's text: no line breaks, at most 200 characters. */
const choiceTextSchema = z
  .string()
  .trim()
  .min(1, { message: 'Each choice needs text' })
  .max(200)
  .refine((text) => !/[\r\n]/u.test(text), { message: 'Choice text is one line' });

/** One line of ink logic or a condition: no line breaks. */
const inkLineSchema = z
  .string()
  .trim()
  .max(500)
  .refine((text) => !/[\r\n]/u.test(text), { message: 'Write it on one line' });

/** A divert target: a knot, `knot.stitch`, `END`, or `DONE`. */
export const inkTargetSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?$/u, {
    message: 'Lead to a knot, a knot.stitch, END, or DONE',
  });

/**
 * One of the choices a chapter ends with, in the shape the choices screen
 * edits: `* {condition} [text]`, its `~` lines, then `-> target`.
 */
export const closingChoiceSchema = z.strictObject({
  text: choiceTextSchema,
  /** Offered once (`*`) rather than every time (`+`). */
  once: z.boolean(),
  /** An ink condition without braces, such as `trust > 1 and not met_venn`; empty for none. */
  condition: inkLineSchema,
  /** `~` lines without the `~`, such as `trust += 1`. */
  effects: z.array(inkLineSchema.pipe(z.string().min(1))).max(20),
  to: inkTargetSchema,
});

export const MAX_CLOSING_CHOICES = 20;

/** The end of a chapter as the choices screen edits it. */
export const chapterEndingSchema = z.strictObject({
  choices: z.array(closingChoiceSchema).max(MAX_CLOSING_CHOICES),
  /** With no choices: where the chapter goes on to, or `END`. */
  then: inkTargetSchema,
});

export const chapterEndingDetailSchema = z.strictObject({
  /** Hash of the chapter file it was read from. */
  hash: sha256Schema,
  /** False when the chapter's ending is ink the form cannot show; edit it as ink. */
  editable: z.boolean(),
  /** Why it is not editable here. */
  reason: z.string().nullable(),
  ending: chapterEndingSchema,
});

export const setChapterEndingSchema = z.strictObject({
  ending: chapterEndingSchema,
  expectedHash: sha256Schema,
});

/** What converting a book to ink chapters would write, for the writer to review. */
export const inkConversionPreviewSchema = z.strictObject({
  files: z.array(
    z.strictObject({
      path: bookFilePathSchema,
      before: z.string().nullable(),
      after: z.string(),
    }),
  ),
  /** Names this conversion, so the one applied is the one reviewed. */
  token: sha256Schema,
});

export const convertToInkSchema = z.strictObject({ token: sha256Schema });

/** What playing every path of the story shows (ADR 0032). */
export const pathReportSchema = z.strictObject({
  /** Whether every distinct state was explored; false when the budget ran out first. */
  complete: z.boolean(),
  /** Distinct states explored. */
  explored: z.number().int().nonnegative(),
  /** Paths that reached an ending. */
  endings: z.number().int().nonnegative(),
  /** Fewest and most choices from the start to an ending. */
  shortest: z.number().int().nonnegative().nullable(),
  longest: z.number().int().nonnegative().nullable(),
  /** Knots and stitches no explored path visits. */
  unreached: z.array(
    z.strictObject({
      node: z.string(),
      title: z.string(),
      path: bookFilePathSchema.nullable(),
      line: z.number().int().positive().nullable(),
    }),
  ),
  /** Choices no explored path offers: their condition never holds, or nothing leads there. */
  neverOffered: z.array(
    z.strictObject({
      node: z.string(),
      text: z.string(),
      path: bookFilePathSchema.nullable(),
      line: z.number().int().positive().nullable(),
    }),
  ),
  /** Runtime errors, each with the choices from the start that reach it. */
  errors: z.array(
    z.strictObject({ message: z.string(), path: z.array(z.number().int().nonnegative()) }),
  ),
});

/** A file's unsaved text, to check the story as it would be with it. */
export const inkCheckSchema = z.strictObject({
  path: bookFilePathSchema,
  content: z.string().max(2_000_000),
});

export const pinnedIfidSchema = z.strictObject({ ifid: z.string() });

export type InkDiagnostic = z.infer<typeof inkDiagnosticSchema>;
export type StoryChoice = z.infer<typeof storyChoiceSchema>;
export type StoryNode = z.infer<typeof storyNodeSchema>;
export type StoryVariable = z.infer<typeof storyVariableSchema>;
export type StoryChapter = z.infer<typeof storyChapterSchema>;
export type InteractiveStory = z.infer<typeof interactiveStorySchema>;
export type PlayKnot = z.infer<typeof playKnotSchema>;
export type BookPlay = z.infer<typeof bookPlaySchema>;
export type ClosingChoice = z.infer<typeof closingChoiceSchema>;
export type ChapterEnding = z.infer<typeof chapterEndingSchema>;
export type ChapterEndingDetail = z.infer<typeof chapterEndingDetailSchema>;
export type SetChapterEndingInput = z.infer<typeof setChapterEndingSchema>;
export type InkConversionPreview = z.infer<typeof inkConversionPreviewSchema>;
export type ConvertToInkInput = z.infer<typeof convertToInkSchema>;
export type PinnedIfid = z.infer<typeof pinnedIfidSchema>;
export type InkCheckInput = z.infer<typeof inkCheckSchema>;
export type PathReport = z.infer<typeof pathReportSchema>;
