import { z } from 'zod';

import { providerConfigSchema } from './provider-config.js';

/**
 * Generation controls for the agent's model requests (ADR 0017). They
 * replace notebook-era presets: no prompt modules and no assistant prefill,
 * which would break tool calling.
 */
export const agentGenerationSchema = z.strictObject({
  temperature: z.number().min(0).max(2).multipleOf(0.05),
  topP: z.number().positive().max(1).nullable(),
  maxTokens: z.number().int().min(1).max(131_072).nullable(),
  /** Ask the provider to reason and show it, where the provider supports it. */
  thinking: z.boolean(),
});

export const DEFAULT_AGENT_GENERATION: AgentGeneration = {
  temperature: 1,
  topP: null,
  maxTokens: null,
  thinking: false,
};

export const appSettingsSchema = z.strictObject({
  providerConfig: providerConfigSchema.nullable(),
  /** Agent review mode default: stage the agent's changes for approval (chats can override). */
  agentReviewMode: z.boolean(),
  agentGeneration: agentGenerationSchema,
});

export const patchAppSettingsSchema = z
  .strictObject({
    providerConfig: providerConfigSchema.nullable().optional(),
    agentReviewMode: z.boolean().optional(),
    agentGeneration: agentGenerationSchema.optional(),
  })
  .refine((value) => Object.values(value).some((setting) => setting !== undefined), {
    message: 'At least one setting is required',
  });

export type AgentGeneration = z.infer<typeof agentGenerationSchema>;
export type AppSettings = z.infer<typeof appSettingsSchema>;
export type PatchAppSettings = z.infer<typeof patchAppSettingsSchema>;
