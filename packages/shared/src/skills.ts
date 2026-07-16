import { z } from 'zod';

// agentskills.io identity: lowercase alphanumerics and single hyphens, ≤64
// characters, matching the skill's directory name.
export const skillNameSchema = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, {
    message: 'Skill names use lowercase letters, numbers, and single hyphens',
  });

export const skillDescriptionSchema = z.string().trim().min(1).max(1024);

const skillLicenseSchema = z.string().trim().min(1).max(200);

export const skillOriginSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('created') }),
  z.strictObject({ type: z.literal('paste') }),
  z.strictObject({
    type: z.literal('bundled'),
    starterId: skillNameSchema,
  }),
]);

export const skillContentSchema = z.string().max(200_000);

export const skillMetadataSchema = z.strictObject({
  id: z.uuid(),
  name: skillNameSchema,
  description: skillDescriptionSchema,
  dirPath: z.string().min(1).max(4096),
  origin: skillOriginSchema,
  license: skillLicenseSchema.nullable(),
  wordCount: z.number().int().nonnegative(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const skillMetadataListSchema = z.array(skillMetadataSchema);

export const skillDetailSchema = skillMetadataSchema.extend({
  content: skillContentSchema,
});

export const createSkillSchema = z.strictObject({
  name: skillNameSchema,
  description: skillDescriptionSchema,
  content: skillContentSchema.refine((value) => value.trim().length > 0, {
    message: 'Skill content is required',
  }),
  license: skillLicenseSchema.nullable().default(null),
  origin: skillOriginSchema.default({ type: 'created' }),
});

export const patchSkillSchema = z
  .strictObject({
    name: skillNameSchema.optional(),
    description: skillDescriptionSchema.optional(),
    content: skillContentSchema
      .refine((value) => value.trim().length > 0, { message: 'Skill content is required' })
      .optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined || value.description !== undefined || value.content !== undefined,
    { message: 'At least one skill field is required' },
  );

export const generationSkillSnapshotSchema = z.strictObject({
  id: z.uuid(),
  name: skillNameSchema,
  description: skillDescriptionSchema,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  content: skillContentSchema,
});

export const starterSkillSchema = z.strictObject({
  starterId: skillNameSchema,
  name: skillNameSchema,
  description: skillDescriptionSchema,
  installed: z.boolean(),
});

export const installStarterSkillsSchema = z.strictObject({
  starterIds: z.array(skillNameSchema).min(1).max(100),
});

export type SkillOrigin = z.infer<typeof skillOriginSchema>;
export type SkillMetadata = z.infer<typeof skillMetadataSchema>;
export type SkillDetail = z.infer<typeof skillDetailSchema>;
export type CreateSkill = z.output<typeof createSkillSchema>;
export type CreateSkillInput = z.input<typeof createSkillSchema>;
export type PatchSkill = z.infer<typeof patchSkillSchema>;
export type GenerationSkillSnapshot = z.infer<typeof generationSkillSnapshotSchema>;
export type StarterSkill = z.infer<typeof starterSkillSchema>;
export type InstallStarterSkills = z.infer<typeof installStarterSkillsSchema>;
