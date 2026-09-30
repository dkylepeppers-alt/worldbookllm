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
  /**
   * Why the notebook has not finished moving. Its book then holds none of its
   * sources or chats yet, and the move is tried again at the next start.
   */
  error: z.string().nullable(),
});

export const notebookMigrationReportSchema = z.strictObject({
  entries: z.array(notebookMigrationEntrySchema),
  /** Where `data/notebooks/` was renamed to, relative to the data dir; null until every notebook has moved. */
  archivePath: z.string().nullable(),
  /** True once the writer has dismissed the report. */
  seen: z.boolean(),
});

export type NotebookMigrationEntry = z.infer<typeof notebookMigrationEntrySchema>;
export type NotebookMigrationReport = z.infer<typeof notebookMigrationReportSchema>;
