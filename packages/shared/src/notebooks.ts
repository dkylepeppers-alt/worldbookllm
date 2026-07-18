import { z } from 'zod';

const notebookNameSchema = z.string().trim().min(1).max(200);

export const notebookSchema = z.strictObject({
  id: z.uuid(),
  name: notebookNameSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const notebookListSchema = z.array(notebookSchema);

export const createNotebookSchema = z.strictObject({
  name: notebookNameSchema,
});

export const patchNotebookSchema = z.strictObject({
  name: notebookNameSchema,
});

export type Notebook = z.infer<typeof notebookSchema>;
export type NotebookList = z.infer<typeof notebookListSchema>;
export type CreateNotebookInput = z.input<typeof createNotebookSchema>;
export type CreateNotebook = z.infer<typeof createNotebookSchema>;
export type PatchNotebook = z.infer<typeof patchNotebookSchema>;
