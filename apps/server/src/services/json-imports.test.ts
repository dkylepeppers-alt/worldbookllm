import { describe, expect, it } from 'vitest';

import { previewSillyTavernJson } from './json-imports.js';

function json(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value));
}

describe('SillyTavern JSON imports', () => {
  it('creates one content-only preview per native lorebook entry', () => {
    const preview = previewSillyTavernJson(
      json({
        entries: {
          0: { uid: 0, comment: 'Eldoria', key: ['kingdom'], content: 'Eldoria is old.' },
          1: { uid: 1, key: ['Moon Gate'], content: 'The gate opens at dusk.' },
        },
      }),
      'world.json',
    );

    expect(preview.format).toBe('lorebook');
    expect(preview.entries).toEqual([
      { title: 'Eldoria', markdown: 'Eldoria is old.' },
      { title: 'Moon Gate', markdown: 'The gate opens at dusk.' },
    ]);
    expect(JSON.stringify(preview)).not.toContain('"uid"');
  });

  it('extracts character context while omitting card metadata', () => {
    const preview = previewSillyTavernJson(
      json({
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: {
          name: 'Seraphina',
          description: 'A forest healer.',
          personality: 'Gentle.',
          scenario: 'A moonlit grove.',
          first_mes: 'Welcome.',
          mes_example: '<START>Hello',
          creator_notes: 'Private note',
          creator: 'Author',
          tags: ['fantasy'],
          alternate_greetings: ['You made it.'],
          extensions: {
            fav: true,
            depth_prompt: { prompt: 'Never breaks character.', depth: 4, role: 'system' },
          },
        },
      }),
      'seraphina.json',
    );

    expect(preview.format).toBe('character');
    expect(preview.entries[0]?.title).toBe('Seraphina');
    expect(preview.entries[0]?.markdown).toContain('## Description\n\nA forest healer.');
    expect(preview.entries[0]?.markdown).toContain('## Character Note\n\nNever breaks character.');
    expect(preview.entries[0]?.markdown).not.toContain('Private note');
    expect(preview.entries[0]?.markdown).not.toContain('fantasy');
    expect(preview.entries[0]?.markdown).not.toContain('depth');
  });

  it('supports legacy flat character JSON and rejects unrelated or empty imports', () => {
    expect(
      previewSillyTavernJson(
        json({
          name: 'Legacy',
          description: 'Description',
          personality: '',
          scenario: '',
          first_mes: 'Hello',
          mes_example: '',
        }),
        'legacy.json',
      ).entries[0]?.markdown,
    ).toContain('## First Message\n\nHello');

    expect(() => previewSillyTavernJson(json({ hello: 'world' }), 'other.json')).toThrow(
      /not a supported/u,
    );
    expect(() => previewSillyTavernJson(json({ entries: {} }), 'empty.json')).toThrow(
      /no entries/u,
    );
  });
});
