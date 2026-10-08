import { z } from 'zod';

import {
  conversionNotesSchema,
  sourceOriginSchema,
  sourcePreviewFormatSchema,
  sourceTitleSchema,
} from './sources.js';

/**
 * Story-skills books (ADR 0014). A book is a story-skills schema v2 project on
 * disk; its identity is the folder slug, and every file inside it is
 * addressed by its project-relative path.
 */

// Kebab-case like story-skills ids, so a slug is always a valid folder name.
export const bookSlugSchema = z
  .string()
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, {
    message: 'Book slugs use lowercase letters, numbers, and single hyphens',
  });

export const bookParamsSchema = z.strictObject({ book: bookSlugSchema });

/** Project-relative POSIX path of a Markdown file inside a book. */
export const bookFilePathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine((path) => !path.includes('\0') && !path.includes('\\'), {
    message: 'Paths use forward slashes and no NUL characters',
  });

export const BOOK_ENTITY_KINDS = [
  'character',
  'location',
  'system',
  'faction',
  'artifact',
  'arc',
  'chapter',
  'scene',
  'question',
  'promise',
  'clue',
  'term',
  'matter',
  'research',
] as const;

export const bookEntityKindSchema = z.enum(BOOK_ENTITY_KINDS);

export const BOOK_FILE_KINDS = [
  ...BOOK_ENTITY_KINDS,
  'story',
  'style-sheet',
  'progress',
  'timeline',
  'state',
  'exemptions',
  'registry',
  'other',
] as const;

export const bookFileKindSchema = z.enum(BOOK_FILE_KINDS);

export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

export const bookFileSchema = z.strictObject({
  path: bookFilePathSchema,
  kind: bookFileKindSchema,
  entityId: z.string().nullable(),
  title: z.string(),
  hash: sha256Schema,
  size: z.number().int().nonnegative(),
  updatedAt: z.iso.datetime(),
});

export const bookFileDetailSchema = bookFileSchema.extend({
  content: z.string(),
  /** Parsed frontmatter, or null when the file has none or it cannot be parsed. */
  frontmatter: z.record(z.string(), z.unknown()).nullable(),
});

export const bookSummarySchema = z.strictObject({
  slug: bookSlugSchema,
  title: z.string(),
  genre: z.string().nullable(),
  status: z.string().nullable(),
  /** A series bible is addressed like a book, by its series id (ADR 0018). */
  kind: z.enum(['book', 'series-bible']),
  /** The series whose folder holds the book (ADR 0018); null for a standalone book. */
  seriesId: z.string().nullable(),
  bookNumber: z.number().nullable(),
  /** Linked predecessor book slugs, normalized from story.md's relative paths. */
  follows: z.array(bookSlugSchema),
  /** Linked successor book slugs, normalized from story.md's relative paths. */
  precedes: z.array(bookSlugSchema),
  counts: z.record(z.string(), z.number().int().nonnegative()),
  updatedAt: z.iso.datetime(),
});

export const bookTreeSchema = z.strictObject({
  book: bookSummarySchema,
  files: z.array(bookFileSchema),
});

export const bookConflictSchema = z.strictObject({
  slug: bookSlugSchema,
  path: z.string(),
  seriesId: bookSlugSchema.nullable(),
  kind: z.enum(['book', 'series-bible']),
});
export type BookConflict = z.infer<typeof bookConflictSchema>;

export const STORY_TENSES = ['past', 'present', 'future', 'mixed'] as const;

const shortTextSchema = z.string().trim().min(1).max(200);

export const createBookSchema = z.strictObject({
  title: z.string().trim().min(1).max(300),
  genre: shortTextSchema.optional(),
  subGenre: shortTextSchema.optional(),
  pov: shortTextSchema.optional(),
  tense: z.enum(STORY_TENSES).optional(),
  form: shortTextSchema.optional(),
  synopsis: z.string().trim().min(1).max(2000).optional(),
});

/** A new series: its folder and series bible (ADR 0018). */
export const createSeriesSchema = z.strictObject({
  title: z.string().trim().min(1).max(300),
});

/** A new book inside a series, optionally linked after or before one of its books. */
export const addSeriesBookSchema = z
  .strictObject({
    title: z.string().trim().min(1).max(300),
    follows: bookSlugSchema.optional(),
    precedes: bookSlugSchema.optional(),
    bookNumber: z.number().int().positive().max(999).optional(),
  })
  .refine((input) => input.follows === undefined || input.precedes === undefined, {
    message: 'A new book follows one book or precedes one, not both',
  });

/** Moves a standalone book into a series: an existing one, or a new one with this title. */
export const moveBookToSeriesSchema = z.union([
  z.strictObject({ seriesId: bookSlugSchema }),
  z.strictObject({ newSeriesTitle: z.string().trim().min(1).max(300) }),
]);

export const BOOK_FILE_MAX_CHARS = 5_000_000;

export const writeBookFileSchema = z.strictObject({
  content: z.string().max(BOOK_FILE_MAX_CHARS),
  /** Hash of the version being replaced, or null to create a file that must not exist yet. */
  expectedHash: sha256Schema.nullable(),
});

/** Values for `story add`/`rename`/`move` options; each command validates the names it accepts. */
export const storyOptionValueSchema = z.union([
  z.string().max(2000),
  z.boolean(),
  z.array(z.string().max(2000)).max(50),
]);

export const storyOptionsSchema = z.record(z.string().max(40), storyOptionValueSchema).default({});

export const addEntitySchema = z.strictObject({
  kind: bookEntityKindSchema,
  name: z.string().trim().min(1).max(300),
  options: storyOptionsSchema,
});

export const entityParamsSchema = z.strictObject({
  book: bookSlugSchema,
  kind: bookEntityKindSchema,
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
});

export const renameEntitySchema = z.strictObject({
  name: z.string().trim().min(1).max(300),
  id: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
    .optional(),
});

export const moveEntitySchema = z.strictObject({
  number: z.number().int().positive().optional(),
  chapter: z.string().max(100).optional(),
  scene: z.number().int().positive().optional(),
});

/** Read-only `story` commands the checks endpoint runs with --json. */
export const BOOK_CHECK_COMMANDS = [
  'check',
  'validate',
  'links',
  'continuity',
  'timeline',
  'pacing',
  'clues',
  'voices',
  'series',
  'report',
  'next',
  'doctor',
  'progress',
  'prose',
  'grid',
  'mentions',
  'list',
] as const;

export const bookCheckCommandSchema = z.enum(BOOK_CHECK_COMMANDS);

export const bookCheckParamsSchema = z.strictObject({
  book: bookSlugSchema,
  command: bookCheckCommandSchema,
});

/**
 * Arguments for the checks that take them: `list` needs a kind and takes
 * `--where` filters, and `mentions` takes a kind and id for one entity
 * (without them it audits every chapter). The CLI validates the values.
 */
export const bookCheckQuerySchema = z
  .strictObject({
    kind: z
      .string()
      .regex(/^[a-z][a-z-]*$/u)
      .max(40)
      .optional(),
    id: z
      .string()
      .regex(/^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u)
      .max(120)
      .optional(),
    where: z
      .union([z.string(), z.array(z.string())])
      .transform((value) => (Array.isArray(value) ? value : [value]))
      .pipe(z.array(z.string().trim().min(1).max(200)).max(10))
      .optional(),
  })
  .refine((query) => query.id === undefined || query.kind !== undefined, {
    message: 'An entity id needs its kind.',
    path: ['id'],
  });

export const storyDiagnosticSchema = z.looseObject({
  severity: z.string(),
  file: z.string().nullable().optional(),
  chapter: z.string().nullable().optional(),
  message: z.string(),
  code: z.string().optional(),
});

/** The story CLI's `--json` envelope (apiVersion story/v2). */
export const storyEnvelopeSchema = z.looseObject({
  apiVersion: z.string(),
  command: z.string(),
  ok: z.boolean(),
  data: z.unknown(),
  diagnostics: z.array(storyDiagnosticSchema),
});

export const bookCheckResultSchema = z.strictObject({
  command: bookCheckCommandSchema,
  exitCode: z.number().int(),
  envelope: storyEnvelopeSchema,
});

export const storyCommandOutcomeSchema = z.strictObject({
  /** The CLI's own report of what it did, with the book root shown as `.`. */
  output: z.string(),
  checkpointId: z.uuid().nullable(),
  validation: storyEnvelopeSchema.nullable(),
});

export const checkpointChangeSchema = z.enum(['created', 'modified', 'deleted']);

export const checkpointFileSchema = z.strictObject({
  path: bookFilePathSchema,
  change: checkpointChangeSchema,
});

export const checkpointSchema = z.strictObject({
  id: z.uuid(),
  book: bookSlugSchema,
  label: z.string(),
  actor: z.enum(['user', 'agent']),
  createdAt: z.iso.datetime(),
  undoneAt: z.iso.datetime().nullable(),
  files: z.array(checkpointFileSchema),
});

export const checkpointDetailSchema = checkpointSchema.extend({
  files: z.array(
    checkpointFileSchema.extend({
      before: z.string().nullable(),
      after: z.string().nullable(),
    }),
  ),
});

export const checkpointParamsSchema = z.strictObject({ book: bookSlugSchema, id: z.uuid() });

export const bookSearchQuerySchema = z.strictObject({ q: z.string().max(500) });

export const bookSearchResultSchema = z.strictObject({
  path: bookFilePathSchema,
  kind: bookFileKindSchema,
  title: z.string(),
  excerpt: z.string().max(1000),
});

export type BookEntityKind = z.infer<typeof bookEntityKindSchema>;
export type BookFileKind = z.infer<typeof bookFileKindSchema>;
export type BookFile = z.infer<typeof bookFileSchema>;
export type BookFileDetail = z.infer<typeof bookFileDetailSchema>;
export type BookSummary = z.infer<typeof bookSummarySchema>;
export type BookTree = z.infer<typeof bookTreeSchema>;
export type CreateBookInput = z.infer<typeof createBookSchema>;
export type WriteBookFileInput = z.infer<typeof writeBookFileSchema>;
export type StoryOptions = z.infer<typeof storyOptionsSchema>;
export type CreateSeriesInput = z.infer<typeof createSeriesSchema>;
export type AddSeriesBookInput = z.infer<typeof addSeriesBookSchema>;
export type MoveBookToSeriesInput = z.infer<typeof moveBookToSeriesSchema>;
export type AddEntityInput = z.infer<typeof addEntitySchema>;
export type RenameEntityInput = z.infer<typeof renameEntitySchema>;
export type MoveEntityInput = z.infer<typeof moveEntitySchema>;
export type BookCheckCommand = z.infer<typeof bookCheckCommandSchema>;
export type BookCheckQuery = z.input<typeof bookCheckQuerySchema>;
export type StoryEnvelope = z.infer<typeof storyEnvelopeSchema>;
export type BookCheckResult = z.infer<typeof bookCheckResultSchema>;
export type StoryCommandOutcome = z.infer<typeof storyCommandOutcomeSchema>;
export type Checkpoint = z.infer<typeof checkpointSchema>;
export type CheckpointDetail = z.infer<typeof checkpointDetailSchema>;
export type BookSearchResult = z.infer<typeof bookSearchResultSchema>;

/**
 * Book ingestion (ADR 0014 decision 5). Previews reuse the source converters;
 * each entry carries the entity kind it should become, suggested from its
 * frontmatter, format, title, or folder and changeable at review. A chapter
 * is appended after the book's last chapter. An entry from a zip carries its
 * own file origin.
 */
export const BOOK_IMPORT_KINDS = [
  'research',
  'character',
  'location',
  'system',
  'faction',
  'artifact',
  'arc',
  'question',
  'promise',
  'clue',
  'term',
  'matter',
  'chapter',
] as const;

export const bookImportKindSchema = z.enum(BOOK_IMPORT_KINDS);

export const bookImportPreviewSchema = z.strictObject({
  format: sourcePreviewFormatSchema,
  origin: sourceOriginSchema,
  conversionNotes: conversionNotesSchema,
  entries: z
    .array(
      z.strictObject({
        title: sourceTitleSchema,
        markdown: z.string().min(1).max(10_485_760),
        suggestedKind: bookImportKindSchema,
        /** The entry is already a story-skills entity file and keeps its own frontmatter. */
        entityFile: z.boolean(),
        /** Where this entry came from, when it differs from the upload (a file inside a zip). */
        origin: sourceOriginSchema.optional(),
        /** This entry's own conversion notes, when they differ from the upload's. */
        conversionNotes: conversionNotesSchema.optional(),
      }),
    )
    .min(1)
    .max(1_000),
});

export const createBookImportSchema = z.strictObject({
  origin: sourceOriginSchema,
  conversionNotes: conversionNotesSchema.default([]),
  entries: z
    .array(
      z.strictObject({
        title: sourceTitleSchema,
        markdown: z.string().min(1).max(10_485_760),
        kind: bookImportKindSchema,
        origin: sourceOriginSchema.optional(),
        conversionNotes: conversionNotesSchema.optional(),
      }),
    )
    .min(1)
    .max(1_000),
});

export const bookImportResultSchema = z.strictObject({
  files: z.array(bookFilePathSchema),
  checkpointId: z.uuid().nullable(),
  validation: storyEnvelopeSchema.nullable(),
});

export const manuscriptImportResultSchema = z.strictObject({
  book: bookSummarySchema,
  /**
   * What the import did: for a manuscript, the CLI's report (chapter and word
   * counts, entity candidates to review); for a project zip, the files kept and
   * skipped and what validation found.
   */
  output: z.string(),
});

/** `story build --format` values (story-skills 0.23.0). `codex` writes a folder, not a file, so it is left out. */
export const BOOK_BUILD_FORMATS = [
  'markdown',
  'epub',
  'docx',
  'shunn',
  'html',
  'print',
  'narration',
  'metadata',
  'fountain',
  'twee',
  'ink',
] as const;

export const bookBuildFormatSchema = z.enum(BOOK_BUILD_FORMATS);

/** `story build --format print --trim` sizes. */
export const PRINT_TRIM_SIZES = ['5x8', '5.25x8', '5.5x8.5', '6x9', 'a5'] as const;

export const createBookBuildSchema = z
  .strictObject({
    format: bookBuildFormatSchema,
    /** Shunn manuscript formatting; docx only. */
    shunn: z.boolean().optional(),
    /** Print trim size; print only. */
    trim: z.enum(PRINT_TRIM_SIZES).optional(),
    /** Build label printed at the top of an HTML review copy; html only. */
    stamp: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine((value) => !value.includes('\0'), { message: 'The stamp cannot contain NUL' })
      .optional(),
  })
  .superRefine((input, context) => {
    const only = (key: 'shunn' | 'trim' | 'stamp', format: string) => {
      if (input[key] !== undefined && input[key] !== false && input.format !== format) {
        context.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} applies only to ${format} builds`,
        });
      }
    };
    only('shunn', 'docx');
    only('trim', 'print');
    only('stamp', 'html');
  });

/** A file name directly inside a book's `dist/` folder. */
export const bookBuildFileNameSchema = z
  .string()
  .min(1)
  .max(255)
  .refine(
    (name) =>
      !name.startsWith('.') && !name.includes('/') && !name.includes('\\') && !name.includes('\0'),
    { message: 'Build files are named without slashes or a leading dot' },
  );

export const bookBuildParamsSchema = z.strictObject({
  book: bookSlugSchema,
  file: bookBuildFileNameSchema,
});

export const bookBuildFileSchema = z.strictObject({
  name: bookBuildFileNameSchema,
  size: z.number().int().nonnegative(),
  updatedAt: z.iso.datetime(),
});

export const bookBuildResultSchema = z.strictObject({
  file: bookBuildFileSchema,
  /** The CLI's report, including any warnings it printed. */
  output: z.string(),
});

export type BookImportKind = z.infer<typeof bookImportKindSchema>;
export type BookImportPreview = z.infer<typeof bookImportPreviewSchema>;
export type CreateBookImportInput = z.infer<typeof createBookImportSchema>;
export type BookImportResult = z.infer<typeof bookImportResultSchema>;
export type ManuscriptImportResult = z.infer<typeof manuscriptImportResultSchema>;
export const bookManuscriptSchema = z.strictObject({
  /** The manuscript as `story export` assembles it: chapter prose and matter pages only. */
  markdown: z.string(),
  /** What the CLI warned about, such as chapters with no prose yet. */
  warnings: z.array(z.string()),
});

export type BookManuscript = z.infer<typeof bookManuscriptSchema>;
export type BookBuildFormat = z.infer<typeof bookBuildFormatSchema>;
export type CreateBookBuildInput = z.infer<typeof createBookBuildSchema>;
export type BookBuildFile = z.infer<typeof bookBuildFileSchema>;
export type BookBuildResult = z.infer<typeof bookBuildResultSchema>;
