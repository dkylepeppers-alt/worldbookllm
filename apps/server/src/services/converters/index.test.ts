import { describe, expect, it } from 'vitest';

import { InvalidImportError } from '../../errors.js';
import { fixture } from './__fixtures__/load.js';
import { convertUpload } from './index.js';
import { MARKDOWN_LIMIT_BYTES } from './limits.js';

describe('convertUpload detection', () => {
  it('routes by content and builds a file origin with the detected media type', async () => {
    const cases: [string, string, string, string][] = [
      ['sample.md', 'sample.md', 'markdown', 'text/markdown'],
      ['crlf-bom.txt', 'crlf-bom.txt', 'text', 'text/plain'],
      ['sample.pdf', 'setting-bible.pdf', 'pdf', 'application/pdf'],
      ['article.html', 'sunken-court.html', 'html', 'text/html'],
      ['lorebook-sillytavern.json', 'atlas.json', 'lorebook', 'application/json'],
      ['generic.json', 'project.json', 'json', 'application/json'],
    ];
    for (const [fixtureName, fileName, format, mediaType] of cases) {
      const preview = await convertUpload(fixture(fixtureName), fileName);
      expect(preview.format, fixtureName).toBe(format);
      expect(preview.origin).toEqual({ type: 'file', fileName, mediaType });
    }
  });

  it('detects a mislabeled PDF (PDF bytes with a .txt name) by magic bytes', async () => {
    const preview = await convertUpload(fixture('mislabeled.txt'), 'mislabeled.txt');
    expect(preview.format).toBe('pdf');
  });

  it('sniffs JSON content behind a non-JSON extension', async () => {
    const preview = await convertUpload(fixture('generic.json'), 'export.dat');
    expect(preview.format).toBe('json');
  });

  it('sniffs HTML content behind a non-HTML extension', async () => {
    const preview = await convertUpload(fixture('article.html'), 'export.dat');
    expect(preview.format).toBe('html');
  });

  it('converts HTML content behind a .json extension as HTML', async () => {
    const preview = await convertUpload(fixture('article.html'), 'export.json');
    expect(preview.format).toBe('html');
  });

  it('rejects an empty upload', async () => {
    await expect(convertUpload(Buffer.alloc(0), 'empty.txt')).rejects.toBeInstanceOf(
      InvalidImportError,
    );
  });

  it('rejects non-UTF-8, non-PDF binary', async () => {
    await expect(convertUpload(fixture('binary.bin'), 'mystery.bin')).rejects.toBeInstanceOf(
      InvalidImportError,
    );
  });

  it('rejects malformed JSON behind a .json extension', async () => {
    await expect(convertUpload(fixture('malformed.json'), 'atlas.json')).rejects.toBeInstanceOf(
      InvalidImportError,
    );
  });

  it('rejects converted Markdown that exceeds the size cap', async () => {
    const huge = Buffer.from('a'.repeat(MARKDOWN_LIMIT_BYTES + 1));
    await expect(convertUpload(huge, 'huge.txt')).rejects.toBeInstanceOf(InvalidImportError);
  });
});
