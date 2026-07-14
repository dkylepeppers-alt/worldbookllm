import { describe, expect, it } from 'vitest';

import { InvalidImportError } from '../../errors.js';
import { fixture } from './__fixtures__/load.js';
import { convertMarkdown } from './markdown.js';

describe('convertMarkdown', () => {
  it('titles from the first heading and preserves the Markdown verbatim', () => {
    const result = convertMarkdown(fixture('sample.md'), 'sample.md');
    expect(result.format).toBe('markdown');
    expect(result.mediaType).toBe('text/markdown');
    expect(result.conversionNotes).toEqual([]);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.title).toBe('Glass Marsh');
    expect(result.entries[0]?.markdown).toContain('## Factions');
    expect(result.entries[0]?.markdown).toContain('- The Reed Wardens');
  });

  it('falls back to the file name stem when there is no heading', () => {
    const result = convertMarkdown(Buffer.from('Just a paragraph, no heading.'), 'lore-notes.md');
    expect(result.entries[0]?.title).toBe('lore-notes');
  });

  it('rejects a blank Markdown file', () => {
    expect(() => convertMarkdown(Buffer.from('   \n\n'), 'blank.md')).toThrow(InvalidImportError);
  });
});
