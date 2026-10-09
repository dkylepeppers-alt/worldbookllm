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
  choices: z.array(z.strictObject({ text: z.string(), to: z.string() })),
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
  /** The ink source `story build --format ink` writes. */
  source: z.string(),
  /** That source compiled by inkjs to ink's JSON story format. */
  story: z.string(),
  knots: z.array(playKnotSchema),
  /** What the build and the ink compiler warned about. */
  warnings: z.array(z.string()),
});

export const pinnedIfidSchema = z.strictObject({ ifid: z.string() });

export type ChapterChoice = z.infer<typeof chapterChoiceSchema>;
export type SetChapterChoicesInput = z.infer<typeof setChapterChoicesSchema>;
export type BranchChapter = z.infer<typeof branchChapterSchema>;
export type BookBranches = z.infer<typeof bookBranchesSchema>;
export type PlayKnot = z.infer<typeof playKnotSchema>;
export type BookPlay = z.infer<typeof bookPlaySchema>;
export type PinnedIfid = z.infer<typeof pinnedIfidSchema>;
