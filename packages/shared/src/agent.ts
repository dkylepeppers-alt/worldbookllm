import { z } from 'zod';

import {
  bookFilePathSchema,
  bookSlugSchema,
  checkpointChangeSchema,
  checkpointSchema,
} from './books.js';
import { skillMetadataSchema, skillNameSchema } from './skills.js';

/**
 * Agent chats on story-skills books (ADR 0015): a bounded tool-calling loop
 * whose every model request, tool call, and tool result is recorded with
 * the assistant message, and whose file changes form one checkpoint.
 */

/**
 * A saved custom agent: extra standing instructions and the skills it may
 * use, picked when a chat starts. Chats without one use the default agent.
 */
export const customAgentSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1).max(80),
  description: z.string().max(500),
  instructions: z.string().max(20_000),
  /** Names of the installed skills it may use; null allows every installed skill. */
  skills: z.array(skillNameSchema).max(500).nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const createCustomAgentSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).default(''),
  instructions: z.string().max(20_000).default(''),
  skills: z.array(skillNameSchema).max(500).nullable().default(null),
});

export const patchCustomAgentSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(500).optional(),
    instructions: z.string().max(20_000).optional(),
    skills: z.array(skillNameSchema).max(500).nullable().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'At least one field is required',
  });

export const customAgentParamsSchema = z.strictObject({ id: z.uuid() });

export const agentChatSchema = z.strictObject({
  id: z.uuid(),
  book: bookSlugSchema,
  title: z.string().min(1).max(200),
  /** The custom agent this chat runs; null for the default agent. */
  agentId: z.uuid().nullable(),
  /** Review mode for this chat; null follows the global setting. */
  reviewMode: z.boolean().nullable(),
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
  /**
   * On a user message: what the app told the model alongside it, such as how
   * the writer reviewed the previous turn's proposed changes.
   */
  note: z.string().nullable(),
  steps: z.array(agentStepSchema),
  checkpointId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const agentChangesetFileStatusSchema = z.enum(['pending', 'applied', 'skipped']);

/**
 * Review mode: the file changes an agent turn proposed instead of applying.
 * `before` is the file as the turn found it; applying refuses when the file
 * has changed since.
 */
export const agentChangesetSchema = z.strictObject({
  id: z.uuid(),
  chatId: z.uuid(),
  messageId: z.uuid(),
  book: bookSlugSchema,
  createdAt: z.iso.datetime(),
  files: z.array(
    z.strictObject({
      path: bookFilePathSchema,
      change: checkpointChangeSchema,
      status: agentChangesetFileStatusSchema,
    }),
  ),
});

export const agentChangesetDetailSchema = agentChangesetSchema.extend({
  files: z.array(
    z.strictObject({
      path: bookFilePathSchema,
      change: checkpointChangeSchema,
      status: agentChangesetFileStatusSchema,
      before: z.string().nullable(),
      after: z.string().nullable(),
    }),
  ),
});

/** Apply or skip: the listed pending files, or every pending file when omitted. */
export const resolveAgentChangesetSchema = z.strictObject({
  paths: z.array(bookFilePathSchema).min(1).max(1000).optional(),
});

export const agentChangesetResolutionSchema = z.strictObject({
  changeset: agentChangesetSchema,
  /** The checkpoint recording the applied files; null when nothing was applied. */
  checkpoint: checkpointSchema.nullable(),
});

export const agentChangesetParamsSchema = z.strictObject({ id: z.uuid() });

export const agentChatDetailSchema = agentChatSchema.extend({
  messages: z.array(agentMessageSchema),
  changesets: z.array(agentChangesetSchema),
});

export const createAgentChatSchema = z.strictObject({
  title: z.string().trim().min(1).max(200).optional(),
  agentId: z.uuid().nullable().optional(),
  reviewMode: z.boolean().nullable().optional(),
});

export const patchAgentChatSchema = z
  .strictObject({
    agentId: z.uuid().nullable().optional(),
    reviewMode: z.boolean().nullable().optional(),
  })
  .refine((value) => value.agentId !== undefined || value.reviewMode !== undefined, {
    message: 'At least one field is required',
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
  z.strictObject({ type: z.literal('changeset'), changeset: agentChangesetSchema }),
  z.strictObject({ type: z.literal('done'), message: agentMessageSchema }),
  z.strictObject({
    type: z.literal('error'),
    code: z.enum(['provider_error', 'configuration_error', 'internal_error']),
    message: z.string(),
    messageState: agentMessageSchema,
  }),
]);

/** `POST /api/skills-story/install`: skills added, and names already present. */
export const storySkillsInstallResultSchema = z.strictObject({
  installed: z.array(skillMetadataSchema),
  skipped: z.array(z.string()),
});

export function encodeAgentSseEvent(event: AgentStreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export type AgentChat = z.infer<typeof agentChatSchema>;
export type AgentToolCallRecord = z.infer<typeof agentToolCallRecordSchema>;
export type AgentStep = z.infer<typeof agentStepSchema>;
export type AgentMessage = z.infer<typeof agentMessageSchema>;
export type AgentChatDetail = z.infer<typeof agentChatDetailSchema>;
export type AgentStreamEvent = z.infer<typeof agentStreamEventSchema>;
export type CustomAgent = z.infer<typeof customAgentSchema>;
export type CreateCustomAgentInput = z.input<typeof createCustomAgentSchema>;
export type PatchCustomAgentInput = z.infer<typeof patchCustomAgentSchema>;
export type CreateAgentChatInput = z.infer<typeof createAgentChatSchema>;
export type PatchAgentChatInput = z.infer<typeof patchAgentChatSchema>;
export type AgentChangeset = z.infer<typeof agentChangesetSchema>;
export type AgentChangesetDetail = z.infer<typeof agentChangesetDetailSchema>;
export type AgentChangesetResolution = z.infer<typeof agentChangesetResolutionSchema>;
export type StorySkillsInstallResult = z.infer<typeof storySkillsInstallResultSchema>;
