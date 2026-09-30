import { z } from 'zod';

import { bookSlugSchema } from './books.js';

/**
 * The one-time move of notebooks into books (ADR 0014 decision 6, ADR 0017),
 * reported to the writer once.
 */
export const notebookMigrationEntrySchema = z.strictObject({
  notebookName: z.string(),
  bookSlug: bookSlugSchema,
  migratedAt: z.iso.datetime(),
  sourceCount: z.number().int().nonnegative(),
  fileCount: z.number().int().nonnegative(),
  chatCount: z.number().int().nonnegative(),
  /** Why the sources could not be written; the book then exists without them. */
  error: z.string().nullable(),
});

export const notebookMigrationReportSchema = z.strictObject({
  entries: z.array(notebookMigrationEntrySchema),
  /** True once the writer has dismissed the report. */
  seen: z.boolean(),
});

export type NotebookMigrationEntry = z.infer<typeof notebookMigrationEntrySchema>;
export type NotebookMigrationReport = z.infer<typeof notebookMigrationReportSchema>;
