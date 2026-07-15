import { z } from 'zod';

const presetNameSchema = z.string().trim().min(1).max(200);
const moduleNameSchema = z.string().trim().min(1).max(200);

export const generationControlsSchema = z.strictObject({
  temperature: z.number().min(0).max(2).multipleOf(0.05),
  topP: z.number().positive().max(1).nullable(),
  maxTokens: z.number().int().min(1).max(131_072).nullable(),
  assistantPrefill: z.string().max(32_768).nullable(),
});

const generationControlsPatchSchema = generationControlsSchema
  .partial()
  .refine((value) => Object.values(value).some((control) => control !== undefined), {
    message: 'At least one generation control is required',
  });

export const moduleInsertionSchema = z.discriminatedUnion('position', [
  z.strictObject({ position: z.literal('before_history') }),
  z.strictObject({
    position: z.literal('at_depth'),
    depth: z.number().int().nonnegative(),
  }),
]);

const moduleKeySchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/u);

export const customPresetModuleSchema = z
  .strictObject({
    key: moduleKeySchema,
    name: moduleNameSchema,
    kind: z.literal('custom'),
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string().max(100_000),
    enabled: z.boolean(),
    insertion: moduleInsertionSchema,
  })
  .refine((module) => !module.enabled || module.content.trim().length > 0, {
    message: 'Enabled custom modules must contain non-whitespace content',
    path: ['content'],
  });

export const sourcesPresetModuleSchema = z.strictObject({
  key: z.literal('sources'),
  name: moduleNameSchema,
  kind: z.literal('sources'),
  role: z.literal('system'),
  content: z.null(),
  enabled: z.literal(true),
  insertion: moduleInsertionSchema,
});

export const presetModuleSchema = z.discriminatedUnion('kind', [
  customPresetModuleSchema,
  sourcesPresetModuleSchema,
]);

export const presetModulesSchema = z
  .array(presetModuleSchema)
  .max(100)
  .superRefine((modules, context) => {
    const seenKeys = new Set<string>();
    let customContentLength = 0;
    let sourcesCount = 0;

    modules.forEach((module, index) => {
      if (seenKeys.has(module.key)) {
        context.addIssue({
          code: 'custom',
          message: 'Module keys must be unique',
          path: [index, 'key'],
        });
      }
      seenKeys.add(module.key);

      if (module.kind === 'sources') {
        sourcesCount += 1;
      } else {
        customContentLength += module.content.length;
      }
    });

    if (sourcesCount !== 1) {
      context.addIssue({
        code: 'custom',
        message: 'A preset must contain exactly one Sources module',
      });
    }
    if (customContentLength > 1_000_000) {
      context.addIssue({
        code: 'custom',
        message: 'Total custom module content must not exceed 1000000 characters',
      });
    }
  });

const portablePresetShape = {
  schemaVersion: z.literal(1),
  name: presetNameSchema,
  generation: generationControlsSchema,
  modules: presetModulesSchema,
} as const;

export const portablePresetSchema = z.strictObject(portablePresetShape);

export const presetSchema = z.strictObject({
  id: z.uuid(),
  ...portablePresetShape,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const presetListSchema = z.array(presetSchema);

export const appSettingsSchema = z.strictObject({
  defaultPresetId: z.uuid(),
});

export const createPresetSchema = portablePresetSchema;

export const patchPresetSchema = z
  .strictObject({
    name: presetNameSchema.optional(),
    generation: generationControlsPatchSchema.optional(),
    modules: presetModulesSchema.optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined || value.generation !== undefined || value.modules !== undefined,
    { message: 'At least one preset field is required' },
  );

export type GenerationControls = z.infer<typeof generationControlsSchema>;
export type ModuleInsertion = z.infer<typeof moduleInsertionSchema>;
export type CustomPresetModule = z.infer<typeof customPresetModuleSchema>;
export type SourcesPresetModule = z.infer<typeof sourcesPresetModuleSchema>;
export type PresetModule = z.infer<typeof presetModuleSchema>;
export type PortablePreset = z.infer<typeof portablePresetSchema>;
export type Preset = z.infer<typeof presetSchema>;
export type AppSettings = z.infer<typeof appSettingsSchema>;
export type CreatePreset = z.infer<typeof createPresetSchema>;
export type PatchPreset = z.infer<typeof patchPresetSchema>;
