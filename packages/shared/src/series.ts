import { z } from 'zod';

import { bookCheckResultSchema, bookSlugSchema, bookSummarySchema } from './books.js';

export const seriesEntitySchema = z.strictObject({
  kind: z.enum(['character', 'location', 'system', 'faction', 'artifact', 'term']),
  id: bookSlugSchema,
});

export const seriesParamsSchema = z.strictObject({ id: bookSlugSchema });

export const seriesSummarySchema = z.strictObject({
  id: bookSlugSchema,
  bible: bookSummarySchema,
  books: z.array(bookSummarySchema),
});

export const seriesDriftSchema = z.strictObject({
  entity: seriesEntitySchema,
  book: bookSlugSchema,
  fields: z.array(z.string()),
});

export const seriesHealthSchema = z.strictObject({
  series: bookCheckResultSchema,
  links: z.array(z.strictObject({ book: bookSlugSchema, result: bookCheckResultSchema })),
  drift: z.array(seriesDriftSchema),
});

export type SeriesSummary = z.infer<typeof seriesSummarySchema>;
export type SeriesDrift = z.infer<typeof seriesDriftSchema>;
export type SeriesHealth = z.infer<typeof seriesHealthSchema>;
