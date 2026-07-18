import type { Notebook, SourceDetail, SourceMetadata } from '@worldbookllm/shared';
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
      { list: vi.fn().mockReturnValue(existing), get: vi.fn() },
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
      { list: vi.fn().mockReturnValue(existing), get: vi.fn() },
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

  describe('suggestForSources', () => {
    const ids = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ] as const;
    const metadata = ids.map((id) => ({ id, tags: [] })) as SourceMetadata[];
    const details = new Map<string, SourceDetail>(
      ids.map((id, position) => [
        id,
        { id, title: `Source ${position}`, content: `Body ${position}` } as SourceDetail,
      ]),
    );

    it('classifies stored content, excerpted, and keys suggestions by source id', async () => {
      const completeChat = vi.fn().mockResolvedValue(
        JSON.stringify({
          suggestions: [
            { index: 0, category: 'factions', tags: ['iron-compact', 'trade-league', 'harbor'] },
            { index: 1, category: 'places', tags: ['marsh', 'tides', 'salt'] },
          ],
        }),
      );
      const get = vi.fn((id: string): SourceDetail => {
        const detail = details.get(id);
        if (detail === undefined) throw new Error('missing');
        return id === ids[0] ? { ...detail, content: 'x'.repeat(9_000) } : detail;
      });
      const service = new SourceOrganizationService(
        { get: vi.fn().mockReturnValue(notebook) },
        { list: vi.fn().mockReturnValue(metadata), get },
        { completeChat },
      );
      await expect(service.suggestForSources(notebook.id, [...ids])).resolves.toEqual({
        suggestions: [
          {
            sourceId: ids[0],
            category: 'factions',
            tags: ['iron-compact', 'trade-league', 'harbor'],
          },
          { sourceId: ids[1], category: 'places', tags: ['marsh', 'tides', 'salt'] },
        ],
        warning: null,
      });
      const prompt = JSON.stringify(completeChat.mock.calls[0]?.[1]);
      expect(prompt).toContain('Body 1');
      expect(prompt).not.toContain('x'.repeat(5_001));
      expect(prompt).toContain('x'.repeat(5_000));
    });

    it('rejects a source id that is not in the notebook without provider work', async () => {
      const completeChat = vi.fn();
      const service = new SourceOrganizationService(
        { get: vi.fn().mockReturnValue(notebook) },
        { list: vi.fn().mockReturnValue([metadata[0]]), get: vi.fn() },
        { completeChat },
      );
      await expect(service.suggestForSources(notebook.id, [...ids])).rejects.toMatchObject({
        name: 'NotFoundError',
      });
      expect(completeChat).not.toHaveBeenCalled();
    });

    it('blanks unreadable sources, warns, and preserves readable siblings by position', async () => {
      const completeChat = vi.fn().mockResolvedValue(
        JSON.stringify({
          suggestions: [{ index: 1, category: 'places', tags: ['marsh'] }],
        }),
      );
      const get = vi.fn((id: string): SourceDetail => {
        const detail = details.get(id);
        if (id === ids[0] || detail === undefined) throw new Error('unreadable frontmatter');
        return detail;
      });
      const logError = vi.fn();
      const service = new SourceOrganizationService(
        { get: vi.fn().mockReturnValue(notebook) },
        { list: vi.fn().mockReturnValue(metadata), get },
        { completeChat },
        logError,
      );
      await expect(service.suggestForSources(notebook.id, [...ids])).resolves.toEqual({
        suggestions: [
          { sourceId: ids[0], category: null, tags: [] },
          { sourceId: ids[1], category: 'places', tags: ['marsh'] },
        ],
        warning: SOURCE_ORGANIZATION_WARNING,
      });
      expect(logError).toHaveBeenCalledOnce();
    });

    it('returns all blanks without provider work when no source is readable', async () => {
      const completeChat = vi.fn();
      const service = new SourceOrganizationService(
        { get: vi.fn().mockReturnValue(notebook) },
        {
          list: vi.fn().mockReturnValue(metadata),
          get: vi.fn(() => {
            throw new Error('unreadable');
          }),
        },
        { completeChat },
      );
      await expect(service.suggestForSources(notebook.id, [...ids])).resolves.toEqual({
        suggestions: ids.map((sourceId) => ({ sourceId, category: null, tags: [] })),
        warning: SOURCE_ORGANIZATION_WARNING,
      });
      expect(completeChat).not.toHaveBeenCalled();
    });
  });
});
