import { z } from 'zod';

/**
 * Ingestion sources (ADR 0014 decision 5): material converted into book
 * files, with the provenance each imported file keeps in its frontmatter.
 * The notebook-era source library these schemas once described was retired
 * by ADR 0017.
 */
export const sourceTitleSchema = z.string().trim().min(1).max(300);

export const sourceOriginSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('paste') }),
  z.strictObject({
    type: z.literal('file'),
    fileName: z.string().trim().min(1).max(255),
    mediaType: z.string().trim().min(1).max(255),
  }),
  z.strictObject({
    type: z.literal('url'),
    url: z.url({ protocol: /^https?$/u }).max(2048),
    fetchedAt: z.iso.datetime(),
    mediaType: z.string().trim().min(1).max(255),
  }),
  z.strictObject({
    type: z.literal('assistant-response'),
    chatId: z.uuid(),
    messageId: z.uuid(),
  }),
]);

export const conversionNotesSchema = z.array(z.string().trim().min(1).max(500)).max(20);

export const sourcePreviewFormatSchema = z.enum([
  'markdown',
  'text',
  'pdf',
  'html',
  'lorebook',
  'character',
  'json',
]);

export const sourcePreviewSchema = z.strictObject({
  format: sourcePreviewFormatSchema,
  origin: sourceOriginSchema,
  entries: z
    .array(
      z.strictObject({
        title: sourceTitleSchema,
        markdown: z.string().min(1).max(10_485_760),
      }),
    )
    .min(1)
    .max(1_000),
  conversionNotes: conversionNotesSchema,
});

export type SourceOrigin = z.infer<typeof sourceOriginSchema>;
export type SourcePreviewFormat = z.infer<typeof sourcePreviewFormatSchema>;
export type SourcePreview = z.infer<typeof sourcePreviewSchema>;
