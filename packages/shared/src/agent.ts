import { z } from 'zod';

import { bookSlugSchema, checkpointSchema } from './books.js';

/**
 * Agent chats on story-skills books (ADR 0015): a bounded tool-calling loop
 * whose every model request, tool call, and tool result is recorded with
 * the assistant message, and whose file changes form one checkpoint.
 */

export const agentChatSchema = z.strictObject({
  id: z.uuid(),
  book: bookSlugSchema,
  title: z.string().min(1).max(200),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const agentToolCallRecordSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  /** The arguments exactly as the model sent them (a JSON string). */
  arguments: z.string(),
  ok: z.boolean(),
  /** What the model was given back, after truncation. */
  result: z.string(),
  durationMs: z.number().nonnegative(),
});

export const agentStepSchema = z.strictObject({
  index: z.number().int().nonnegative(),
  /** The secret-free provider request body for this step. */
  requestBody: z.record(z.string(), z.unknown()),
  text: z.string(),
  toolCalls: z.array(agentToolCallRecordSchema),
});

export const agentMessageStatusSchema = z.enum(['complete', 'streaming', 'interrupted', 'error']);

export const agentMessageSchema = z.strictObject({
  id: z.uuid(),
  chatId: z.uuid(),
  seq: z.number().int().nonnegative(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  reasoning: z.string().nullable(),
  status: agentMessageStatusSchema,
  steps: z.array(agentStepSchema),
  checkpointId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const agentChatDetailSchema = agentChatSchema.extend({
  messages: z.array(agentMessageSchema),
});

export const createAgentChatSchema = z.strictObject({
  title: z.string().trim().min(1).max(200).optional(),
});

export const sendAgentMessageSchema = z.strictObject({
  content: z.string().trim().min(1).max(100_000),
});

export const agentChatParamsSchema = z.strictObject({ id: z.uuid() });

export const agentStreamEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('delta'), text: z.string(), reasoning: z.string().optional() }),
  z.strictObject({ type: z.literal('step'), index: z.number().int().nonnegative() }),
  z.strictObject({
    type: z.literal('tool_call'),
    stepIndex: z.number().int().nonnegative(),
    id: z.string(),
    name: z.string(),
    arguments: z.string(),
  }),
  z.strictObject({
    type: z.literal('tool_result'),
    stepIndex: z.number().int().nonnegative(),
    id: z.string(),
    ok: z.boolean(),
    summary: z.string(),
  }),
  z.strictObject({ type: z.literal('checkpoint'), checkpoint: checkpointSchema }),
  z.strictObject({ type: z.literal('done'), message: agentMessageSchema }),
  z.strictObject({
    type: z.literal('error'),
    code: z.enum(['provider_error', 'configuration_error', 'internal_error']),
    message: z.string(),
    messageState: agentMessageSchema,
  }),
]);

export function encodeAgentSseEvent(event: AgentStreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export type AgentChat = z.infer<typeof agentChatSchema>;
export type AgentToolCallRecord = z.infer<typeof agentToolCallRecordSchema>;
export type AgentStep = z.infer<typeof agentStepSchema>;
export type AgentMessage = z.infer<typeof agentMessageSchema>;
export type AgentChatDetail = z.infer<typeof agentChatDetailSchema>;
export type AgentStreamEvent = z.infer<typeof agentStreamEventSchema>;
