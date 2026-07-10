import { z } from 'zod';

export const PROVIDER_SOURCES = [
  'openai',
  'claude',
  'openrouter',
  'ai21',
  'makersuite',
  'vertexai',
  'mistralai',
  'custom',
  'cohere',
  'perplexity',
  'groq',
  'chutes',
  'electronhub',
  'nanogpt',
  'deepseek',
  'aimlapi',
  'xai',
  'pollinations',
  'moonshot',
  'fireworks',
  'cometapi',
  'azure_openai',
  'zai',
  'siliconflow',
  'minimax',
  'workers_ai',
] as const;

export const providerSourceSchema = z.enum(PROVIDER_SOURCES);

export const providerConnectionSchema = z.strictObject({
  source: providerSourceSchema,
  baseUrl: z.url().max(2048).optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});

export const providerConfigSchema = providerConnectionSchema.extend({
  model: z.string().trim().min(1).max(256),
});

export type ProviderSource = z.infer<typeof providerSourceSchema>;
export type ProviderConnection = z.infer<typeof providerConnectionSchema>;
export type ProviderConfig = z.infer<typeof providerConfigSchema>;
