import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

import {
  carryIdentity,
  mergeIdentity,
  identityDifferences,
  SERIES_FIELDS,
  SERIES_FIELDS_VERSION,
} from './series-fields.js';
import { parseFrontmatter } from './book-index.js';

describe('series identity contract', () => {
  it('merges only canon while keeping local fields and body sections', () => {
    const bible =
      '---\nid: mira\nname: Mira\naliases: [Captain]\nrole: antagonist\nstatus: dead\n---\n# Mira\n\n## Appearance\nGreen eyes.\n\n## Character Arc\nBible arc.\n';
    const target =
      '---\nid: mira\nname: Mira\nrole: protagonist\nstatus: alive\ncustom: keep\n---\n# Mira\n\n## Appearance\nBlue eyes.\n\n## Character Arc\nLocal arc.\n';
    const merged = mergeIdentity('character', bible, target);
    expect(parseFrontmatter(merged).frontmatter).toMatchObject({
      aliases: ['Captain'],
      role: 'protagonist',
      status: 'alive',
      custom: 'keep',
    });
    expect(merged).toContain('## Appearance\nGreen eyes.');
    expect(merged).toContain('## Character Arc\nLocal arc.');
    expect(merged).not.toContain('Bible arc.');
    expect(identityDifferences('character', bible, merged)).toEqual([]);
  });

  it('removes absent canon fields/sections without deleting local content', () => {
    const result = mergeIdentity(
      'character',
      '---\nname: Mira\n---\n',
      '---\nname: Mira\naliases: [Queen]\n---\n## Appearance\nOld canon\n\n## Timeline\nKeep me\n',
    );
    expect(parseFrontmatter(result).frontmatter).not.toHaveProperty('aliases');
    expect(result).not.toContain('Old canon');
    expect(result).toContain('## Timeline\nKeep me');
  });

  it('carries identity without source-book state, references, or an id field', () => {
    const content =
      '---\nid: mira\nname: Mira\naliases: [Captain]\nrole: antagonist\nstatus: dead\nlocations: [old-city]\ncustom: secret\n---\n# Mira\n\n## Appearance\nGreen eyes.\n\n## Timeline\nLocal history.\n';
    const result = carryIdentity('character', content, 'mira');
    expect(parseFrontmatter(result).frontmatter).toEqual({
      name: 'Mira',
      aliases: ['Captain'],
      role: 'supporting',
      status: 'alive',
    });
    expect(result).toContain('Green eyes.');
    expect(result).not.toContain('Local history');
    expect(result).not.toContain('old-city');
  });
  it('only names fields present in the pinned upstream schema', () => {
    const require = createRequire(import.meta.url);
    const schema = JSON.parse(
      readFileSync(require.resolve('story-skills/schemas/story.schema.json'), 'utf8'),
    ) as { $defs: Record<string, { properties: Record<string, unknown> }> };
    const upstream = JSON.parse(
      readFileSync(require.resolve('story-skills/package.json'), 'utf8'),
    ) as {
      version: string;
    };
    expect(SERIES_FIELDS_VERSION).toBe('0.23.0');
    expect(upstream.version).toBe(SERIES_FIELDS_VERSION);
    expect(Object.keys(SERIES_FIELDS)).toEqual([
      'character',
      'location',
      'system',
      'faction',
      'artifact',
      'term',
    ]);
    for (const [kind, fields] of Object.entries(SERIES_FIELDS)) {
      for (const field of [...fields.identity, ...fields.local]) {
        expect(schema.$defs[kind]?.properties, `${kind}.${field}`).toHaveProperty(field);
      }
    }
  });

  it('reports canon frontmatter and named body sections, ignoring local and unknown fields', () => {
    const bible =
      '---\nname: Mira\naliases: [Captain]\nstatus: alive\ncustom: bible\n---\n# Mira\n\n## Appearance\nBlue eyes.\n\n## Character Arc\nBible arc.\n';
    const book = bible
      .replace('[Captain]', '[Queen]')
      .replace('Blue eyes.', 'Green eyes.')
      .replace('status: alive', 'status: dead')
      .replace('custom: bible', 'custom: book')
      .replace('Bible arc.', 'Book arc.');
    expect(identityDifferences('character', bible, book)).toEqual(['aliases', 'body:Appearance']);
  });

  it('does not mistake fenced headings for section boundaries', () => {
    const bible =
      '---\nname: Mira\n---\n## Appearance\n```md\n## Character Arc\ncanon\n```\n## Character Arc\nlocal\n';
    expect(identityDifferences('character', bible, bible.replace('canon', 'changed'))).toEqual([
      'body:Appearance',
    ]);
    expect(identityDifferences('character', bible, bible.replace('local', 'changed'))).toEqual([]);
  });

  it('includes missing canon sections and ignores location current state', () => {
    expect(
      identityDifferences('location', '## Description\nCity\n', '## Current State\nRuins\n'),
    ).toEqual(['body:Description']);
    expect(
      identityDifferences('artifact', '## Current State\nLost\n', '## Current State\nFound\n'),
    ).toEqual([]);
  });

  it('compares all system and term body content but not unknown frontmatter', () => {
    const bible = '---\nterm: Light\ncustom: one\n---\nDefinition\n';
    expect(identityDifferences('term', bible, bible.replace('custom: one', 'custom: two'))).toEqual(
      [],
    );
    expect(
      identityDifferences('term', bible, bible.replace('Definition', 'New definition')),
    ).toEqual(['body']);
    expect(identityDifferences('system', 'One rule\n', 'Two rules\n')).toEqual(['body']);
  });

  it('compares nested frontmatter structurally, not by YAML spelling', () => {
    expect(
      identityDifferences(
        'character',
        '---\naliases: [Mira, Captain]\n---\n',
        '---\naliases:\n  - Mira\n  - Captain\n---\n',
      ),
    ).toEqual([]);
  });
});
