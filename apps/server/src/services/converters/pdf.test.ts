import { describe, expect, it } from 'vitest';

import { InvalidImportError } from '../../errors.js';
import { fixture } from './__fixtures__/load.js';
import { convertPdf } from './pdf.js';

describe('convertPdf', () => {
  it('extracts text and records a best-effort conversion note', async () => {
    const result = await convertPdf(fixture('sample.pdf'), 'setting-bible.pdf');
    expect(result.format).toBe('pdf');
    expect(result.mediaType).toBe('application/pdf');
    expect(result.entries[0]?.markdown).toContain('Glass Marsh Setting Bible');
    expect(result.entries[0]?.markdown).toContain('swallows every road');
    expect(result.conversionNotes[0]).toMatch(/1-page PDF/u);
  });

  it('rejects a PDF with no extractable text', async () => {
    await expect(convertPdf(fixture('empty-text.pdf'), 'scan.pdf')).rejects.toBeInstanceOf(
      InvalidImportError,
    );
  });

  it('rejects a corrupt PDF', async () => {
    await expect(convertPdf(fixture('corrupt.pdf'), 'broken.pdf')).rejects.toBeInstanceOf(
      InvalidImportError,
    );
  });
});
