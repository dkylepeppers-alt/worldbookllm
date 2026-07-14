import { describe, expect, it } from 'vitest';

import { InvalidImportError } from '../../errors.js';
import { fixture } from './__fixtures__/load.js';
import { convertText } from './text.js';

describe('convertText', () => {
  it('strips the BOM, normalizes newlines, and collapses blank runs', () => {
    const result = convertText(fixture('crlf-bom.txt'), 'crlf-bom.txt');
    expect(result.format).toBe('text');
    expect(result.mediaType).toBe('text/plain');
    expect(result.conversionNotes).toEqual([]);
    expect(result.entries[0]?.title).toBe('crlf-bom');
    expect(result.entries[0]?.markdown).toBe('The Amber Court\n\nGuards the eastern fen.');
  });

  it('rejects an empty text file', () => {
    expect(() => convertText(fixture('empty.txt'), 'empty.txt')).toThrow(InvalidImportError);
  });
});
