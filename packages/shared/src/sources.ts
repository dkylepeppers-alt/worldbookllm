import { z } from 'zod';

export const sourceTitleSchema = z.string().trim().min(1).max(300);

/** Canonical source categories (M3). The UI derives its pickers from this list. */
export const SOURCE_CATEGORIES = [
  'characters',
  'places',
  'factions',
  'timelines',
  'lore',
  'rules',
  'style',
  'plot',
  'research',
  'misc',
] as const;

export const sourceCategorySchema = z.enum(SOURCE_CATEGORIES);

// Commas are rejected so the UI can use them as a lossless tag separator.
export const sourceTagsSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1)
      .max(50)
      .refine((tag) => !tag.includes(','), { message: 'Tags cannot contain commas' }),
  )
  .max(20);

export const SOURCE_ORGANIZATION_MAX_DRAFTS = 100;
export const SOURCE_ORGANIZATION_MAX_CONTENT = 500_000;

export const sourceOrganizationDraftSchema = z.strictObject({
  index: z.number().int().nonnegative(),
  title: sourceTitleSchema,
  content: z.string().min(1).max(10_485_760),
});

export const sourceOrganizationRequestSchema = z
  .strictObject({
    drafts: z.array(sourceOrganizationDraftSchema).min(1).max(SOURCE_ORGANIZATION_MAX_DRAFTS),
  })
  .superRefine(({ drafts }, context) => {
    const seen = new Set<number>();
    for (const draft of drafts) {
      if (seen.has(draft.index)) {
        context.addIssue({
          code: 'custom',
          path: ['drafts'],
          message: 'Draft indices must be unique',
        });
      }
      seen.add(draft.index);
    }
    if (
      drafts.reduce((total, draft) => total + draft.content.length, 0) >
      SOURCE_ORGANIZATION_MAX_CONTENT
    ) {
      context.addIssue({
        code: 'custom',
        path: ['drafts'],
        message: `Draft content cannot exceed ${SOURCE_ORGANIZATION_MAX_CONTENT} characters`,
      });
    }
  });

export const sourceOrganizationSuggestionSchema = z.strictObject({
  index: z.number().int().nonnegative(),
  category: sourceCategorySchema.nullable(),
  tags: sourceTagsSchema.max(5),
});

export const sourceOrganizationResponseSchema = z.strictObject({
  suggestions: z.array(sourceOrganizationSuggestionSchema),
  warning: z.string().min(1).nullable(),
});

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
  category: sourceCategorySchema.nullable(),
  tags: sourceTagsSchema,
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
  category: sourceCategorySchema.nullable().default(null),
  tags: sourceTagsSchema.default([]),
});
export const createSourcesSchema = z.array(createSourceSchema).min(1).max(1_000);

// Ordinary edit of a saved source: title, content, category, and/or tags.
// Origin, conversion notes, id, and createdAt are preserved by the server;
// re-ingestion is a separate concern. `category: null` clears the category.
export const patchSourceSchema = z
  .strictObject({
    title: sourceTitleSchema.optional(),
    content: z.string().min(1).max(10_485_760).optional(),
    category: sourceCategorySchema.nullable().optional(),
    tags: sourceTagsSchema.optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'At least one source field is required',
  });

export const sourceSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
});

// A ranked full-text hit: the source's metadata plus a plain-text excerpt
// around the match (no highlight markers in M3).
export const sourceSearchResultSchema = sourceMetadataSchema.extend({
  excerpt: z.string().max(1000),
});
export const sourceSearchResultListSchema = z.array(sourceSearchResultSchema);

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
export type SourceCategory = z.infer<typeof sourceCategorySchema>;
export type SourceOrganizationDraft = z.infer<typeof sourceOrganizationDraftSchema>;
export type SourceOrganizationRequest = z.infer<typeof sourceOrganizationRequestSchema>;
export type SourceOrganizationSuggestion = z.infer<typeof sourceOrganizationSuggestionSchema>;
export type SourceOrganizationResponse = z.infer<typeof sourceOrganizationResponseSchema>;
export type SourceSearchQuery = z.infer<typeof sourceSearchQuerySchema>;
export type SourceSearchResult = z.infer<typeof sourceSearchResultSchema>;
export type SourceMetadata = z.infer<typeof sourceMetadataSchema>;
export type SourceMetadataList = z.infer<typeof sourceMetadataListSchema>;
export type SourceDetail = z.infer<typeof sourceDetailSchema>;
export type CreateSource = z.output<typeof createSourceSchema>;
export type CreateSourceInput = z.input<typeof createSourceSchema>;
export type CreateSourcesInput = z.input<typeof createSourcesSchema>;
export type PatchSource = z.infer<typeof patchSourceSchema>;
export type SourcePreviewFormat = z.infer<typeof sourcePreviewFormatSchema>;
export type SourcePreview = z.infer<typeof sourcePreviewSchema>;
