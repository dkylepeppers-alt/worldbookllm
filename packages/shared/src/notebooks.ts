import { z } from 'zod';

import { providerConfigSchema } from './provider-config.js';

const notebookNameSchema = z.string().trim().min(1).max(200);

export const notebookSchema = z.strictObject({
  id: z.uuid(),
  name: notebookNameSchema,
  settings: providerConfigSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const notebookListSchema = z.array(notebookSchema);

export const createNotebookSchema = z.strictObject({
  name: notebookNameSchema,
  settings: providerConfigSchema.nullable().default(null),
});

export const patchNotebookSchema = z
  .strictObject({
    name: notebookNameSchema.optional(),
    settings: providerConfigSchema.nullable().optional(),
  })
  .refine((value) => value.name !== undefined || value.settings !== undefined, {
    message: 'At least one notebook field is required',
  });

export type Notebook = z.infer<typeof notebookSchema>;
export type NotebookList = z.infer<typeof notebookListSchema>;
export type CreateNotebookInput = z.input<typeof createNotebookSchema>;
export type CreateNotebook = z.infer<typeof createNotebookSchema>;
export type PatchNotebook = z.infer<typeof patchNotebookSchema>;
