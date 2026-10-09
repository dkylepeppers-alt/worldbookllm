import { z } from 'zod';

import { bookFilePathSchema, bookSlugSchema, sha256Schema } from './books.js';

/**
 * Interactive books: chapters joined by the `choices` in their frontmatter
 * (story-skills 0.23.0, the `interactive-fiction` skill). The chapters and
 * their choices are the source of truth; `story build --format twee` and
 * `--format ink` read them.
 */

/** Text story-skills refuses in a choice, because Twine reads it as link syntax. */
export const CHOICE_TEXT_UNSAFE = /[[\]|\r\n]|->|<-|<$/u;

export const CHOICE_TEXT_RULE =
  'Choice text cannot contain [, ], |, ->, <-, or a line break, or end in <.';

export const chapterIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, {
  message: 'Chapter ids use lowercase letters, numbers, and single hyphens',
});

export const MAX_CHAPTER_CHOICES = 20;

/**
 * A `sets` or `requires` entry: a flag name (`found_coat`), or `not` and a
 * flag name. In `requires` it can also be a chapter id, meaning the reader
 * has read that chapter. The server checks what needs the book: that a flag
 * is not a chapter's ink knot name or a word ink reserves.
 */
export const choiceStateEntrySchema = z
  .string()
  .trim()
  .regex(/^(?:not\s+)?[A-Za-z_][A-Za-z0-9_-]*$/u, {
    message: 'Use a flag name of letters, digits, and underscores, or "not" and a flag name',
  });

export const MAX_CHOICE_STATE = 10;

export const chapterChoiceSchema = z.strictObject({
  /** The words the reader picks. */
  text: z
    .string()
    .trim()
    .min(1, { message: 'Each choice needs text' })
    .max(200)
    .refine((text) => !CHOICE_TEXT_UNSAFE.test(text), { message: CHOICE_TEXT_RULE }),
  /** The id of the chapter it leads to. */
  to: chapterIdSchema,
  /** Flags choosing it sets: `name` true, `not name` false (worldbookllm's ink, ADR 0028). */
  sets: z.array(choiceStateEntrySchema).max(MAX_CHOICE_STATE).default([]),
  /** All must hold for the choice to be offered: flags, or chapter ids already read. */
  requires: z.array(choiceStateEntrySchema).max(MAX_CHOICE_STATE).default([]),
});

/** Replaces a chapter's choices; an empty list removes the field. */
export const setChapterChoicesSchema = z.strictObject({
  choices: z.array(chapterChoiceSchema).max(MAX_CHAPTER_CHOICES),
  /** Hash of the chapter file the choices were read from. */
  expectedHash: sha256Schema,
});

export const chapterParamsSchema = z.strictObject({
  book: bookSlugSchema,
  id: chapterIdSchema,
});

export const branchChapterSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  path: bookFilePathSchema,
  hash: sha256Schema,
  /** Well-formed choices, in file order; `to` may name a chapter that does not exist. */
  choices: z.array(
    z.strictObject({
      text: z.string(),
      to: z.string(),
      sets: z.array(z.string()),
      requires: z.array(z.string()),
    }),
  ),
  /** Malformed choice entries, which the builds refuse, described for the writer. */
  problems: z.array(z.string()),
  /** The first chapter, where the reader starts. */
  start: z.boolean(),
  /** A chapter without choices in a branching book: the story ends there. */
  ending: z.boolean(),
  /** Whether some path of choices from the start leads here. */
  reachable: z.boolean(),
});

export const bookBranchesSchema = z.strictObject({
  /** True once any chapter has a choice; until then chapters run in order. */
  branching: z.boolean(),
  /** The IFID pinned in story.md, or null while builds derive one from the title. */
  ifid: z.string().nullable(),
  /** An `ifid` in story.md that is not a version 4 UUID, which the builds refuse. */
  invalidIfid: z.string().nullable(),
  /** Every flag the book's choices set or require, for suggestions. */
  flags: z.array(z.string()),
  chapters: z.array(branchChapterSchema),
});

/** A chapter's knot in the ink build: `chapter-03` becomes `chapter_03`. */
export const playKnotSchema = z.strictObject({
  knot: z.string(),
  chapterId: z.string(),
  title: z.string(),
});

/** The book as an ink story, for the Play screen to run with inkle's runtime. */
export const bookPlaySchema = z.strictObject({
  title: z.string(),
  ifid: z.string(),
  /** The ink source worldbookllm's ink writer makes from the build (ADR 0028). */
  source: z.string(),
  /** That source compiled by inkjs to ink's JSON story format. */
  story: z.string(),
  knots: z.array(playKnotSchema),
  /** The story's flags, which the Play screen shows as they change. */
  flags: z.array(z.string()),
  /** What the build and the ink compiler warned about. */
  warnings: z.array(z.string()),
});

export const pinnedIfidSchema = z.strictObject({ ifid: z.string() });

export type ChapterChoice = z.infer<typeof chapterChoiceSchema>;
export type ChapterChoiceInput = z.input<typeof chapterChoiceSchema>;
/** What a client sends; `sets` and `requires` may be left out. */
export type SetChapterChoicesInput = z.input<typeof setChapterChoicesSchema>;
export type SetChapterChoices = z.infer<typeof setChapterChoicesSchema>;
export type BranchChapter = z.infer<typeof branchChapterSchema>;
export type BookBranches = z.infer<typeof bookBranchesSchema>;
export type PlayKnot = z.infer<typeof playKnotSchema>;
export type BookPlay = z.infer<typeof bookPlaySchema>;
export type PinnedIfid = z.infer<typeof pinnedIfidSchema>;
