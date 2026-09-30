import { describe, expect, it } from 'vitest';

import {
  entityKindOf,
  fillCreatedEntity,
  importedBody,
  kebabId,
  provenanceLines,
  renderEntityFile,
  splitFrontmatter,
} from './book-import.js';

describe('entityKindOf', () => {
  it.each([
    [{ term: 'Ember', category: 'magic' }, 'term'],
    [{ title: 'Epigraph', placement: 'front' }, 'matter'],
    [{ title: 'The key', status: 'planted', 'red-herring': true }, 'clue'],
    [{ title: 'The bell', status: 'open', planted: 'chapter-01' }, 'promise'],
    [{ title: 'Who rang it?', status: 'open', introduced: 'chapter-01' }, 'question'],
    [{ title: 'Tides', status: 'open', sources: [] }, 'research'],
    [{ name: 'Sera', role: 'protagonist', status: 'alive' }, 'character'],
    [{ name: 'Council', type: 'guild', status: 'active', members: [] }, 'faction'],
    [{ name: 'Lantern', type: 'relic', status: 'intact', owner: 'sera' }, 'artifact'],
    [{ name: 'Reclamation', type: 'character', status: 'active', acts: [] }, 'arc'],
    [{ name: 'Ember magic', type: 'magic', prevalence: 'rare' }, 'system'],
    [{ name: 'Port Kestrel', type: 'city', region: 'coast' }, 'location'],
  ])('recognizes %j as %s', (frontmatter, kind) => {
    expect(entityKindOf(frontmatter)).toBe(kind);
  });

  it('refuses ambiguous, incomplete, and nested frontmatter', () => {
    expect(entityKindOf({ name: 'Somewhere', type: 'city' })).toBeNull();
    expect(entityKindOf({ title: 'Draft', status: 'draft' })).toBeNull();
    expect(
      entityKindOf({ name: 'Sera', role: 'lead', status: 'alive', meta: { a: 1 } }),
    ).toBeNull();
  });
});

describe('frontmatter rendering', () => {
  const provenance = provenanceLines(
    { type: 'file', fileName: 'a "b".md', mediaType: 'text/markdown' },
    ['Converted from HTML'],
    '2026-09-30T00:00:00.000Z',
  );

  it('quotes provenance so the story parser reads it back exactly', () => {
    expect(provenance).toEqual([
      'origin-type: "file"',
      'origin-file: "a \\"b\\".md"',
      'origin-media-type: "text/markdown"',
      'imported-at: "2026-09-30T00:00:00.000Z"',
      'conversion-notes:',
      '  - "Converted from HTML"',
    ]);
  });

  it('skips provenance keys the file already defines, with their list items', () => {
    const file = '---\nname: Sera\nconversion-notes:\n  - "mine"\n---\nBody\n';
    const rendered = renderEntityFile(file, provenance);
    expect(splitFrontmatter(rendered).frontmatterText).toBe(
      [
        'name: Sera',
        'conversion-notes:',
        '  - "mine"',
        'origin-type: "file"',
        'origin-file: "a \\"b\\".md"',
        'origin-media-type: "text/markdown"',
        'imported-at: "2026-09-30T00:00:00.000Z"',
      ].join('\n'),
    );
    expect(rendered.endsWith('\nBody\n')).toBe(true);
  });

  it('replaces a created template body but keeps its heading', () => {
    const created =
      '---\nname: Port Kestrel\ntype: city\n---\n\n# Port Kestrel\n\n## Overview\n\nTemplate.\n';
    expect(fillCreatedEntity(created, 'Bells everywhere.', ['origin-type: "paste"'])).toBe(
      '---\nname: Port Kestrel\ntype: city\norigin-type: "paste"\n---\n\n# Port Kestrel\n\nBells everywhere.\n',
    );
  });

  it('drops a leading heading that repeats the title', () => {
    expect(importedBody('# Tides\n\nText.', 'tides', true)).toBe('Text.');
    expect(importedBody('# Other\n\nText.', 'Tides', true)).toBe('# Other\n\nText.');
  });
});

describe('kebabId', () => {
  it('derives ids the way story-skills does', () => {
    expect(kebabId("Sera's Reclamation")).toBe('seras-reclamation');
    expect(kebabId('Café  Noir!')).toBe('cafe-noir');
    expect(kebabId('Пётр')).toBe('');
  });
});
