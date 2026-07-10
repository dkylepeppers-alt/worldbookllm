import { z } from 'zod';

import { providerConfigSchema, providerSourceSchema } from './provider-config.js';

const chatTitleSchema = z.string().trim().min(1).max(200);
const sourceIdsSchema = z
  .array(z.uuid())
  .max(1_000)
  .refine((ids) => new Set(ids).size === ids.length, { message: 'Source IDs must be unique' });

export const generationContextSchema = z.strictObject({
  sourceIds: z.array(z.uuid()).max(1_000),
  provider: providerSourceSchema,
  model: z.string().min(1).max(256),
  strictness: z.literal('grounded'),
});

export const messageSchema = z.strictObject({
  id: z.uuid(),
  chatId: z.uuid(),
  seq: z.number().int().nonnegative(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  reasoning: z.string().nullable(),
  status: z.enum(['complete', 'interrupted', 'error']),
  context: generationContextSchema.nullable(),
  createdAt: z.iso.datetime(),
});

export const chatSchema = z.strictObject({
  id: z.uuid(),
  notebookId: z.uuid(),
  title: chatTitleSchema,
  sourceIds: sourceIdsSchema,
  providerOverride: providerConfigSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const chatDetailSchema = chatSchema.extend({ messages: z.array(messageSchema) });

export const createChatSchema = z.strictObject({
  title: chatTitleSchema.default('New chat'),
  sourceIds: sourceIdsSchema.default([]),
  providerOverride: providerConfigSchema.nullable().default(null),
});

export const patchChatSchema = z
  .strictObject({
    title: chatTitleSchema.optional(),
    sourceIds: sourceIdsSchema.optional(),
    providerOverride: providerConfigSchema.nullable().optional(),
  })
  .refine(
    (value) =>
      value.title !== undefined ||
      value.sourceIds !== undefined ||
      value.providerOverride !== undefined,
    { message: 'At least one chat field is required' },
  );

export const createMessageSchema = z.strictObject({
  content: z.string().trim().min(1).max(1_048_576),
});

export type GenerationContext = z.infer<typeof generationContextSchema>;
export type Message = z.infer<typeof messageSchema>;
export type Chat = z.infer<typeof chatSchema>;
export type ChatDetail = z.infer<typeof chatDetailSchema>;
export type CreateChat = z.infer<typeof createChatSchema>;
export type PatchChat = z.infer<typeof patchChatSchema>;
export type CreateMessage = z.infer<typeof createMessageSchema>;
