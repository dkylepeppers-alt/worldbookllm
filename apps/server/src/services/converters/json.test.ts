import { describe, expect, it } from 'vitest';

import { InvalidImportError } from '../../errors.js';
import { fixture } from './__fixtures__/load.js';
import { convertJson } from './json.js';

function convertFixture(name: string) {
  return convertJson(fixture(name).toString('utf8'), name);
}

describe('convertJson', () => {
  it('extracts a SillyTavern lorebook, one source per non-empty entry', () => {
    const result = convertFixture('lorebook-sillytavern.json');
    expect(result.format).toBe('lorebook');
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]?.title).toBe('Amber Court');
    expect(result.entries[0]?.markdown).toContain('hall of fossilized resin');
    expect(result.entries.map((entry) => entry.title)).not.toContain('Empty Entry');
  });

  it('accepts lorebook schema variants (nested container, alternate field names)', () => {
    const result = convertFixture('lorebook-variant.json');
    expect(result.format).toBe('lorebook');
    expect(result.entries).toHaveLength(3);
    expect(result.entries[0]?.title).toBe('The Reed Wardens');
    expect(result.entries[1]?.title).toBe('Tide-Signs');
    expect(result.entries[1]?.markdown).toContain('silent hand-language');
    expect(result.entries[2]?.title).toBe('sunken court');
  });

  it('extracts a V2 character card into one focused Markdown source', () => {
    const result = convertFixture('character-v2.json');
    expect(result.format).toBe('character');
    expect(result.entries).toHaveLength(1);
    const markdown = result.entries[0]?.markdown ?? '';
    expect(markdown).toContain('# Sister Vael');
    expect(markdown).toContain('## Description');
    expect(markdown).toContain('## Alternate Greetings');
    // UI/creator metadata is left behind.
    expect(markdown).not.toContain('worldbuilder');
  });

  it('falls back to a best-effort generic conversion for unrelated JSON', () => {
    const result = convertFixture('generic.json');
    expect(result.format).toBe('json');
    expect(result.entries).toHaveLength(1);
    const markdown = result.entries[0]?.markdown ?? '';
    expect(markdown).toContain('## summary');
    expect(markdown).toContain('every road built across the marsh');
    expect(markdown).toContain('## notes.tone');
    expect(result.conversionNotes[0]).toMatch(/No known lorebook or character card structure/u);
  });

  it('generic conversion emits fenced JSON when no long strings are present', () => {
    const result = convertJson('{"a":1,"b":true,"c":"short"}', 'tiny.json');
    expect(result.format).toBe('json');
    expect(result.entries[0]?.markdown).toContain('```json');
    expect(result.entries[0]?.markdown).toContain('"a": 1');
  });

  it('treats a bare array as a possible lorebook then generic', () => {
    const result = convertJson(
      JSON.stringify([
        { content: 'A drowned bargain older than the causeways and their wardens.' },
      ]),
      'array.json',
    );
    expect(result.format).toBe('lorebook');
    expect(result.entries).toHaveLength(1);
  });

  it('never rejects structurally valid JSON', () => {
    expect(convertJson('42', 'num.json').format).toBe('json');
    expect(convertJson('"just a string"', 'str.json').format).toBe('json');
    expect(convertJson('{"unknown":"shape"}', 'obj.json').format).toBe('json');
  });

  it('rejects unparseable JSON', () => {
    expect(() => convertFixture('malformed.json')).toThrow(InvalidImportError);
  });
});
