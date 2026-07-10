import { z } from 'zod';

const sourceTitleSchema = z.string().trim().min(1).max(300);

export const sourceMetadataSchema = z.strictObject({
  id: z.uuid(),
  notebookId: z.uuid(),
  title: sourceTitleSchema,
  slug: z.string().min(1).max(300),
  filePath: z.string().min(1).max(4096),
  origin: z.literal('paste'),
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
});

export type SourceMetadata = z.infer<typeof sourceMetadataSchema>;
export type SourceMetadataList = z.infer<typeof sourceMetadataListSchema>;
export type SourceDetail = z.infer<typeof sourceDetailSchema>;
export type CreateSource = z.infer<typeof createSourceSchema>;
