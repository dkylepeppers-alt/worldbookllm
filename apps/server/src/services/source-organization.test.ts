import type { Notebook, SourceMetadata } from '@worldbookllm/shared';
import { describe, expect, it, vi } from 'vitest';

import {
  SOURCE_ORGANIZATION_WARNING,
  SourceOrganizationService,
  buildSourceOrganizationMessages,
  parseSourceOrganizationCompletion,
} from './source-organization.js';

const drafts = [
  { index: 0, title: 'Iron Compact', content: 'A trade league and smuggling cartel.' },
  { index: 3, title: 'Glass Marsh', content: 'A tidal wetland.' },
];

describe('source organization prompt and parsing', () => {
  it('bounds existing vocabulary and labels source content as untrusted data', () => {
    const messages = buildSourceOrganizationMessages(
      drafts,
      Array.from({ length: 250 }, (_, index) => `tag-${String(index).padStart(3, '0')}`),
    );
    const serialized = JSON.stringify(messages);
    expect(serialized).toContain('untrusted reference data');
    expect(serialized).toContain('characters');
    expect(serialized).toContain('misc');
    expect(serialized).toContain('tag-199');
    expect(serialized).not.toContain('tag-200');
    expect(messages[1]?.content).toContain('"index":3');
  });

  it('parses fenced out-of-order JSON and degrades invalid fields independently', () => {
    const result = parseSourceOrganizationCompletion(
      '```json\n{"suggestions":[{"index":3,"category":"ships","tags":["Marsh","bad,tag",7]},{"index":0,"category":"factions","tags":["Trade-League","trade-league","Smugglers"]}]}\n```',
      drafts,
      ['trade-league'],
    );
    expect(result).toEqual({
      suggestions: [
        { index: 0, category: 'factions', tags: ['trade-league', 'smugglers'] },
        { index: 3, category: null, tags: ['marsh'] },
      ],
      warning: SOURCE_ORGANIZATION_WARNING,
    });
  });

  it('warns when a row loses every generated tag to normalization', () => {
    const result = parseSourceOrganizationCompletion(
      '{"suggestions":[{"index":0,"category":"factions","tags":["bad,tag",7]},{"index":3,"category":"places","tags":["tides"]}]}',
      drafts,
      [],
    );
    expect(result).toEqual({
      suggestions: [
        { index: 0, category: 'factions', tags: [] },
        { index: 3, category: 'places', tags: ['tides'] },
      ],
      warning: SOURCE_ORGANIZATION_WARNING,
    });
  });

  it('blanks ambiguous and missing indices while preserving valid siblings', () => {
    const result = parseSourceOrganizationCompletion(
      '{"suggestions":[{"index":0,"category":"factions","tags":[]},{"index":0,"category":"lore","tags":[]}]}',
      drafts,
      [],
    );
    expect(result).toEqual({
      suggestions: [
        { index: 0, category: null, tags: [] },
        { index: 3, category: null, tags: [] },
      ],
      warning: SOURCE_ORGANIZATION_WARNING,
    });
  });
});

describe('SourceOrganizationService', () => {
  const notebook: Notebook = {
    id: 'a0c7607c-b365-438b-a7e6-31b2308464b6',
    name: 'Atlas',
    settings: { source: 'nanogpt', model: 'model-a' },
    createdAt: '2026-07-17T00:00:00.000Z',
    updatedAt: '2026-07-17T00:00:00.000Z',
  };
  const existing = [{ tags: ['trade-league', 'harbor'] }] as SourceMetadata[];

  it('returns blanks without network work when no provider is configured', async () => {
    const completeChat = vi.fn();
    const service = new SourceOrganizationService(
      { get: vi.fn().mockReturnValue({ ...notebook, settings: null }) },
      { list: vi.fn().mockReturnValue(existing) },
      { completeChat },
    );
    await expect(service.suggest(notebook.id, drafts)).resolves.toEqual({
      suggestions: drafts.map(({ index }) => ({ index, category: null, tags: [] })),
      warning: SOURCE_ORGANIZATION_WARNING,
    });
    expect(completeChat).not.toHaveBeenCalled();
  });

  it('uses notebook configuration and turns provider failure into safe blanks', async () => {
    const completeChat = vi.fn().mockRejectedValue(new Error('secret provider detail'));
    const logError = vi.fn();
    const service = new SourceOrganizationService(
      { get: vi.fn().mockReturnValue(notebook) },
      { list: vi.fn().mockReturnValue(existing) },
      { completeChat },
      logError,
    );
    await expect(service.suggest(notebook.id, drafts)).resolves.toMatchObject({
      warning: SOURCE_ORGANIZATION_WARNING,
    });
    expect(completeChat).toHaveBeenCalledWith(
      notebook.settings,
      expect.any(Array),
      { temperature: 0, maxTokens: 448 },
      undefined,
    );
    expect(logError).toHaveBeenCalledOnce();
  });
});
