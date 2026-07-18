import { z } from 'zod';

import { providerSourceSchema } from './provider-config.js';
import { generationControlsSchema, presetSchema } from './presets.js';
import { generationSkillSnapshotSchema } from './skills.js';

const chatTitleSchema = z.string().trim().min(1).max(200);
const sourceIdsSchema = z
  .array(z.uuid())
  .max(1_000)
  .refine((ids) => new Set(ids).size === ids.length, { message: 'Source IDs must be unique' });
const skillIdsSchema = z
  .array(z.uuid())
  .max(100)
  .refine((ids) => new Set(ids).size === ids.length, { message: 'Skill IDs must be unique' });

export const legacyGenerationContextSchema = z.strictObject({
  sourceIds: z.array(z.uuid()).max(1_000),
  provider: providerSourceSchema,
  model: z.string().min(1).max(256),
  strictness: z.literal('grounded'),
});

export const canonicalMessageSchema = z.strictObject({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
});

export function coalesceCanonicalMessages(
  messages: readonly CanonicalMessage[],
): CanonicalMessage[] {
  const coalesced: CanonicalMessage[] = [];
  for (const message of messages) {
    const previous = coalesced.at(-1);
    if (previous?.role === message.role) {
      previous.content = `${previous.content}\n\n${message.content}`;
    } else {
      coalesced.push({ ...message });
    }
  }
  return coalesced;
}

export const generationSourceSnapshotSchema = z.strictObject({
  id: z.uuid(),
  title: z.string().trim().min(1).max(300),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  content: z.string().max(10_485_760),
});

export const presetGenerationContextSchema = z.strictObject({
  contextVersion: z.literal(2),
  preset: presetSchema,
  canonicalMessages: z.array(canonicalMessageSchema),
  sources: z.array(generationSourceSnapshotSchema).max(1_000),
  // Additive and contextVersion-2-compatible: optional so stored exchange
  // snapshots authored before skills existed still validate.
  skills: z.array(generationSkillSnapshotSchema).max(100).optional(),
  requestedControls: generationControlsSchema,
  effectiveRequestBody: z.record(z.string(), z.json()),
  provider: providerSourceSchema,
  model: z.string().min(1).max(256),
});

export const generationContextSchema = z.union([
  legacyGenerationContextSchema,
  presetGenerationContextSchema,
]);

export const messageVariantSchema = z.strictObject({
  content: z.string(),
  reasoning: z.string().nullable(),
  status: z.enum(['complete', 'interrupted', 'error']),
  context: generationContextSchema.nullable(),
  createdAt: z.iso.datetime(),
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
  // The active variant is mirrored into content/reasoning/status/context above so
  // the assembler and every existing reader keep working unchanged. `variants`
  // holds every regenerated response for this turn; `activeVariant` indexes it.
  // Optional so pre-variants fixtures still validate; the server always populates
  // both (absent is treated as a single implicit variant by readers).
  variants: z.array(messageVariantSchema).min(1).optional(),
  activeVariant: z.number().int().nonnegative().optional(),
});

export const chatSchema = z.strictObject({
  id: z.uuid(),
  notebookId: z.uuid(),
  title: chatTitleSchema,
  sourceIds: sourceIdsSchema,
  skillIds: skillIdsSchema,
  presetId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const chatDetailSchema = chatSchema.extend({ messages: z.array(messageSchema) });

export const createChatSchema = z.strictObject({
  title: chatTitleSchema.default('New chat'),
  sourceIds: sourceIdsSchema.default([]),
  skillIds: skillIdsSchema.default([]),
  presetId: z.uuid().nullable().default(null),
});

export const patchChatSchema = z
  .strictObject({
    title: chatTitleSchema.optional(),
    sourceIds: sourceIdsSchema.optional(),
    skillIds: skillIdsSchema.optional(),
    presetId: z.uuid().nullable().optional(),
  })
  .refine(
    (value) =>
      value.title !== undefined ||
      value.sourceIds !== undefined ||
      value.skillIds !== undefined ||
      value.presetId !== undefined,
    { message: 'At least one chat field is required' },
  );

export const createMessageSchema = z.strictObject({
  content: z.string().trim().min(1).max(1_048_576),
});

export const patchMessageSchema = z.strictObject({
  activeVariant: z.number().int().nonnegative(),
});

export type GenerationContext = z.infer<typeof generationContextSchema>;
export type LegacyGenerationContext = z.infer<typeof legacyGenerationContextSchema>;
export type PresetGenerationContext = z.infer<typeof presetGenerationContextSchema>;
export type CanonicalMessage = z.infer<typeof canonicalMessageSchema>;
export type GenerationSourceSnapshot = z.infer<typeof generationSourceSnapshotSchema>;
export type MessageVariant = z.infer<typeof messageVariantSchema>;
export type Message = z.infer<typeof messageSchema>;
export type PatchMessage = z.infer<typeof patchMessageSchema>;
export type Chat = z.infer<typeof chatSchema>;
export type ChatDetail = z.infer<typeof chatDetailSchema>;
export type CreateChat = z.infer<typeof createChatSchema>;
export type PatchChat = z.infer<typeof patchChatSchema>;
export type CreateMessage = z.infer<typeof createMessageSchema>;
