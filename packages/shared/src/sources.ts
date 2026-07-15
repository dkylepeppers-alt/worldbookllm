import { z } from 'zod';

const sourceTitleSchema = z.string().trim().min(1).max(300);

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

export const sourceMetadataSchema = z.strictObject({
  id: z.uuid(),
  notebookId: z.uuid(),
  title: sourceTitleSchema,
  slug: z.string().min(1).max(300),
  filePath: z.string().min(1).max(4096),
  origin: sourceOriginSchema,
  conversionNotes: conversionNotesSchema,
  wordCount: z.number().int().nonnegative(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const sourceMetadataListSchema = z.array(sourceMetadataSchema);

export const sourceDetailSchema = sourceMetadataSchema.extend({
  content: z.string().max(10_485_760),
});

export const createSourceSchema = z.strictObject({
  title: sourceTitleSchema,
  content: z.string().min(1).max(10_485_760),
  origin: sourceOriginSchema.default({ type: 'paste' }),
  conversionNotes: conversionNotesSchema.default([]),
});
export const createSourcesSchema = z.array(createSourceSchema).min(1).max(1_000);

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
export type SourceMetadata = z.infer<typeof sourceMetadataSchema>;
export type SourceMetadataList = z.infer<typeof sourceMetadataListSchema>;
export type SourceDetail = z.infer<typeof sourceDetailSchema>;
export type CreateSource = z.output<typeof createSourceSchema>;
export type CreateSourceInput = z.input<typeof createSourceSchema>;
export type CreateSourcesInput = z.input<typeof createSourcesSchema>;
export type SourcePreviewFormat = z.infer<typeof sourcePreviewFormatSchema>;
export type SourcePreview = z.infer<typeof sourcePreviewSchema>;
