import { z } from 'zod';

export const secretKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_.:-]+$/u);

export const maskedSecretSchema = z.strictObject({
  id: z.uuid(),
  value: z.string().min(1).max(1024),
  label: z.string().min(1).max(200),
  active: z.boolean(),
});

export const secretStateSchema = z.record(secretKeySchema, z.array(maskedSecretSchema));

export const createSecretSchema = z.strictObject({
  key: secretKeySchema,
  value: z.string().min(1).max(65_536),
  label: z.string().trim().min(1).max(200).default('Unlabeled'),
});

export const resourceIdParamsSchema = z.strictObject({ id: z.uuid() });
export const secretParamsSchema = z.strictObject({ key: secretKeySchema, id: z.uuid() });

export type MaskedSecret = z.infer<typeof maskedSecretSchema>;
export type SecretState = z.infer<typeof secretStateSchema>;
export type CreateSecret = z.infer<typeof createSecretSchema>;
