import { z } from 'zod';

import {
  providerConfigSchema,
  providerConnectionSchema,
  providerSourceSchema,
} from './provider-config.js';

export const providerExtraFieldSchema = z.strictObject({
  key: z.string().min(1),
  label: z.string().min(1),
  required: z.boolean(),
  options: z.array(z.string()).optional(),
});

export const providerCatalogEntrySchema = z.strictObject({
  source: providerSourceSchema,
  label: z.string().min(1),
  family: z.enum(['openai-compat', 'dedicated']),
  secretKey: z.string().min(1),
  needsBaseUrl: z.boolean().optional(),
  keyOptional: z.boolean().optional(),
  modelSource: z.enum(['live', 'static']),
  extraFields: z.array(providerExtraFieldSchema).optional(),
  hasSecret: z.boolean(),
});

export const modelInfoSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().optional(),
    description: z.string().optional(),
    contextLength: z.number().optional(),
  })
  .catchall(z.unknown());

export const modelListRequestSchema = providerConnectionSchema;
export const modelListResponseSchema = z.strictObject({ models: z.array(modelInfoSchema) });
export const connectionTestRequestSchema = providerConfigSchema;
export const connectionTestResponseSchema = z.strictObject({
  ok: z.literal(true),
  detail: z.string().min(1),
});

export type ProviderExtraField = z.infer<typeof providerExtraFieldSchema>;
export type ProviderCatalogEntry = z.infer<typeof providerCatalogEntrySchema>;
export type ModelInfo = z.infer<typeof modelInfoSchema>;
export type ModelListResponse = z.infer<typeof modelListResponseSchema>;
export type ConnectionTestResponse = z.infer<typeof connectionTestResponseSchema>;
