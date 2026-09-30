import { describe, expect, it } from 'vitest';

import {
  DEFAULT_AGENT_GENERATION,
  agentGenerationSchema,
  appSettingsSchema,
  patchAppSettingsSchema,
} from './index.js';

describe('app settings schemas', () => {
  it('validates agent generation controls', () => {
    expect(agentGenerationSchema.parse(DEFAULT_AGENT_GENERATION)).toEqual(DEFAULT_AGENT_GENERATION);
    expect(
      agentGenerationSchema.parse({ temperature: 0.7, topP: 0.9, maxTokens: 2048, thinking: true }),
    ).toEqual({ temperature: 0.7, topP: 0.9, maxTokens: 2048, thinking: true });
    expect(() =>
      agentGenerationSchema.parse({ ...DEFAULT_AGENT_GENERATION, temperature: 0.33 }),
    ).toThrow();
    expect(() =>
      agentGenerationSchema.parse({ ...DEFAULT_AGENT_GENERATION, maxTokens: 0 }),
    ).toThrow();
    // Notebook-era preset fields are gone.
    expect(() =>
      agentGenerationSchema.parse({ ...DEFAULT_AGENT_GENERATION, assistantPrefill: 'Sure' }),
    ).toThrow();
  });

  it('validates settings and partial patches', () => {
    const settings = {
      providerConfig: null,
      agentReviewMode: false,
      agentGeneration: DEFAULT_AGENT_GENERATION,
    };
    expect(appSettingsSchema.parse(settings)).toEqual(settings);
    expect(() => appSettingsSchema.parse({ ...settings, defaultPresetId: 'x' })).toThrow();
    expect(patchAppSettingsSchema.parse({ agentReviewMode: true })).toEqual({
      agentReviewMode: true,
    });
    expect(patchAppSettingsSchema.parse({ providerConfig: null })).toEqual({
      providerConfig: null,
    });
    expect(() => patchAppSettingsSchema.parse({})).toThrow();
  });
});
