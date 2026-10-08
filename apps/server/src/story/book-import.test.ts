import { describe, expect, it } from 'vitest';

import {
  archiveDocumentKind,
  chapterTitle,
  entityKindOf,
  fillCreatedChapter,
  fillCreatedEntity,
  importedBody,
  kebabId,
  provenanceLines,
  renderEntityFile,
  splitFrontmatter,
  suggestImportKind,
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

describe('chapter imports', () => {
  it('suggests chapters from titles, file names, and folders, but not in notes folders', () => {
    const kind = (markdown: string, hint: { title?: string; path?: string }) =>
      suggestImportKind(markdown, 'markdown', hint).suggestedKind;
    expect(kind('Text', { title: 'Chapter 3: The Harbor' })).toBe('chapter');
    expect(kind('Text', { title: 'Prologue' })).toBe('chapter');
    expect(kind('Text', { path: 'ch02.md' })).toBe('chapter');
    expect(kind('Text', { path: 'manuscript/the-harbor.md' })).toBe('chapter');
    expect(kind('Text', { path: 'notes/chapter-ideas.md' })).toBe('research');
    expect(kind('Text', { title: 'Harbor notes', path: 'harbor.md' })).toBe('research');
    expect(kind('Text', { title: 'Characterization tips' })).toBe('research');
  });

  it('files every loose zip document as a chapter unless it is a note or an entity', () => {
    expect(archiveDocumentKind('draft/the-harbor.md', 'Prose.')).toBe('chapter');
    expect(archiveDocumentKind('research/salt.md', '# Salt')).toBe('research');
    expect(
      archiveDocumentKind('bram.md', '---\nname: Bram\nrole: supporting\nstatus: alive\n---\n'),
    ).toBe('character');
  });

  it('strips the chapter number from a title, keeping a bare one', () => {
    expect(chapterTitle('Chapter 3: The Harbor')).toBe('The Harbor');
    expect(chapterTitle('CHAPTER ONE — Arrival')).toBe('Arrival');
    expect(chapterTitle('Chapter 12')).toBe('Chapter 12');
    expect(chapterTitle('The Harbor')).toBe('The Harbor');
  });

  it('puts imported prose under Chapter Text and keeps stray frontmatter outside it', () => {
    const created =
      '---\ntitle: Arrival\nnumber: 2\nstatus: outline\n---\n\n# Chapter 2: Arrival\n\n## Outline\n\n1. Beat\n\n---\n\n## Chapter Text\n';
    const filled = fillCreatedChapter(
      created,
      '---\nmood: grim\n---\n# Chapter 2: Arrival\n\nThe ferry docked.\n',
      'Arrival',
      ['origin-type: "paste"'],
    );
    expect(filled).toBe(
      '---\ntitle: Arrival\nnumber: 2\nstatus: draft\norigin-type: "paste"\n---\n\n# Chapter 2: Arrival\n\n## Imported Frontmatter\n\n```yaml\nmood: grim\n```\n\n## Chapter Text\n\nThe ferry docked.\n',
    );
    const ownLayout = fillCreatedChapter(
      created,
      '---\ntitle: Arrival\nstatus: final\n---\n\n# Chapter 9: Arrival\n\n## Chapter Text\n\nOwn prose.\n',
      'Arrival',
      [],
    );
    expect(ownLayout).toContain('## Chapter Text\n\nOwn prose.\n');
    expect(ownLayout).not.toContain('Imported Frontmatter');
  });
});
