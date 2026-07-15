import { describe, expect, it } from 'vitest';

import {
  appSettingsSchema,
  createPresetSchema,
  generationControlsSchema,
  patchPresetSchema,
  portablePresetSchema,
  presetSchema,
} from './index.js';

const PRESET_ID = '73a30f4e-d17c-468c-9e73-a0f9a59732a5';
const NOW = '2026-07-15T12:00:00.000Z';

const sourcesModule = {
  key: 'sources',
  name: 'Selected sources',
  kind: 'sources',
  role: 'system',
  content: null,
  enabled: true,
  insertion: { position: 'at_depth', depth: 4 },
} as const;

const customModule = {
  key: 'assistant-role',
  name: 'Assistant role',
  kind: 'custom',
  role: 'system',
  content: 'You are a worldbuilding assistant.',
  enabled: true,
  insertion: { position: 'before_history' },
} as const;

const portablePreset = {
  schemaVersion: 1,
  name: ' Grounded development ',
  generation: {
    temperature: 0.7,
    topP: null,
    maxTokens: null,
    assistantPrefill: null,
  },
  modules: [customModule, sourcesModule],
};

describe('preset schemas', () => {
  it('parses a portable schema-version 1 preset and trims names', () => {
    expect(portablePresetSchema.parse(portablePreset)).toEqual({
      ...portablePreset,
      name: 'Grounded development',
    });
  });

  it('accepts generation-control boundaries and rejects invalid steps and ranges', () => {
    expect(
      generationControlsSchema.parse({
        temperature: 0,
        topP: 0.0001,
        maxTokens: 1,
        assistantPrefill: '',
      }),
    ).toBeTruthy();
    expect(
      generationControlsSchema.parse({
        temperature: 2,
        topP: 1,
        maxTokens: 131_072,
        assistantPrefill: 'x'.repeat(32_768),
      }),
    ).toBeTruthy();

    for (const generation of [
      { ...portablePreset.generation, temperature: 0.01 },
      { ...portablePreset.generation, temperature: -0.05 },
      { ...portablePreset.generation, temperature: 2.05 },
      { ...portablePreset.generation, topP: 0 },
      { ...portablePreset.generation, topP: 1.01 },
      { ...portablePreset.generation, maxTokens: 0 },
      { ...portablePreset.generation, maxTokens: 1.5 },
      { ...portablePreset.generation, maxTokens: 131_073 },
      { ...portablePreset.generation, assistantPrefill: 'x'.repeat(32_769) },
    ]) {
      expect(() => generationControlsSchema.parse(generation)).toThrow();
    }
  });

  it('rejects unknown fields and unsupported schema versions', () => {
    expect(() => portablePresetSchema.parse({ ...portablePreset, schemaVersion: 2 })).toThrow();
    expect(() => portablePresetSchema.parse({ ...portablePreset, surprise: true })).toThrow();
    expect(() =>
      portablePresetSchema.parse({
        ...portablePreset,
        generation: { ...portablePreset.generation, surprise: true },
      }),
    ).toThrow();
    expect(() =>
      portablePresetSchema.parse({
        ...portablePreset,
        modules: [{ ...customModule, surprise: true }, sourcesModule],
      }),
    ).toThrow();
    expect(() =>
      portablePresetSchema.parse({
        ...portablePreset,
        modules: [
          { ...customModule, insertion: { position: 'before_history', depth: 0 } },
          sourcesModule,
        ],
      }),
    ).toThrow();
  });

  it('validates module keys, names, insertion depths, and enabled content', () => {
    for (const modules of [
      [{ ...customModule, key: 'Uppercase' }, sourcesModule],
      [{ ...customModule, key: `a${'b'.repeat(64)}` }, sourcesModule],
      [{ ...customModule, name: ' ' }, sourcesModule],
      [{ ...customModule, content: ' ', enabled: true }, sourcesModule],
      [{ ...customModule, insertion: { position: 'at_depth', depth: -1 } }, sourcesModule],
      [{ ...customModule, insertion: { position: 'at_depth', depth: 1.5 } }, sourcesModule],
    ]) {
      expect(() => portablePresetSchema.parse({ ...portablePreset, modules })).toThrow();
    }

    expect(
      portablePresetSchema.parse({
        ...portablePreset,
        modules: [{ ...customModule, content: '', enabled: false }, sourcesModule],
      }),
    ).toBeTruthy();
  });

  it('rejects duplicate module keys and more than 100 modules', () => {
    expect(() =>
      portablePresetSchema.parse({
        ...portablePreset,
        modules: [customModule, { ...customModule }, sourcesModule],
      }),
    ).toThrow();

    const customModules = Array.from({ length: 100 }, (_, index) => ({
      ...customModule,
      key: `module-${index}`,
    }));
    expect(() =>
      portablePresetSchema.parse({ ...portablePreset, modules: [...customModules, sourcesModule] }),
    ).toThrow();
  });

  it('requires exactly one valid protected Sources module', () => {
    expect(() =>
      portablePresetSchema.parse({ ...portablePreset, modules: [customModule] }),
    ).toThrow();
    expect(() =>
      portablePresetSchema.parse({
        ...portablePreset,
        modules: [customModule, sourcesModule, sourcesModule],
      }),
    ).toThrow();

    for (const invalidSources of [
      { ...sourcesModule, key: 'source' },
      { ...sourcesModule, role: 'user' },
      { ...sourcesModule, content: '' },
      { ...sourcesModule, enabled: false },
      { ...sourcesModule, kind: 'custom' },
    ]) {
      expect(() =>
        portablePresetSchema.parse({ ...portablePreset, modules: [customModule, invalidSources] }),
      ).toThrow();
    }
  });

  it('enforces per-module and total custom-content limits', () => {
    expect(
      portablePresetSchema.parse({
        ...portablePreset,
        modules: [{ ...customModule, content: 'x'.repeat(100_000) }, sourcesModule],
      }),
    ).toBeTruthy();
    expect(() =>
      portablePresetSchema.parse({
        ...portablePreset,
        modules: [{ ...customModule, content: 'x'.repeat(100_001) }, sourcesModule],
      }),
    ).toThrow();

    const oneMillion = Array.from({ length: 10 }, (_, index) => ({
      ...customModule,
      key: `module-${index}`,
      content: 'x'.repeat(100_000),
    }));
    expect(
      portablePresetSchema.parse({ ...portablePreset, modules: [...oneMillion, sourcesModule] }),
    ).toBeTruthy();
    expect(() =>
      portablePresetSchema.parse({
        ...portablePreset,
        modules: [...oneMillion, { ...customModule, key: 'overflow', content: 'x' }, sourcesModule],
      }),
    ).toThrow();
  });

  it('validates stored presets, app settings, and create/patch payloads', () => {
    expect(
      presetSchema.parse({
        id: PRESET_ID,
        ...portablePreset,
        createdAt: NOW,
        updatedAt: NOW,
      }).id,
    ).toBe(PRESET_ID);
    expect(createPresetSchema.parse(portablePreset).schemaVersion).toBe(1);
    expect(patchPresetSchema.parse({ name: ' Concise ' })).toEqual({ name: 'Concise' });
    expect(patchPresetSchema.parse({ generation: { temperature: 0.4 } })).toEqual({
      generation: { temperature: 0.4 },
    });
    expect(patchPresetSchema.parse({ generation: portablePreset.generation })).toBeTruthy();
    expect(patchPresetSchema.parse({ modules: portablePreset.modules })).toBeTruthy();
    expect(() => patchPresetSchema.parse({})).toThrow();
    expect(() => patchPresetSchema.parse({ generation: {} })).toThrow();
    expect(() =>
      patchPresetSchema.parse({ generation: { temperature: 0.4, extra: true } }),
    ).toThrow();
    expect(() => patchPresetSchema.parse({ name: 'Valid', extra: true })).toThrow();
    expect(appSettingsSchema.parse({ defaultPresetId: PRESET_ID })).toEqual({
      defaultPresetId: PRESET_ID,
    });
    expect(() => appSettingsSchema.parse({ defaultPresetId: PRESET_ID, extra: true })).toThrow();
  });
});
