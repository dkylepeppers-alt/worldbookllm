import { extractText } from 'unpdf';

import { InvalidImportError } from '../../errors.js';
import type { ConversionResult } from './types.js';
import { cleanTitle, fileStem, normalizeText } from './text-utils.js';

/**
 * PDF conversion is best effort and text-only: pdf.js (via unpdf) extracts the
 * text runs, which we normalize like plain text. Layout, images, and table
 * structure are not preserved, and image-only (scanned) PDFs yield no text and
 * are rejected — there is no OCR in M2. The title is taken from the first line
 * of extracted text, falling back to the file name stem.
 */
export async function convertPdf(bytes: Buffer, fileName: string): Promise<ConversionResult> {
  let text: string;
  let totalPages: number;
  try {
    const extracted = await extractText(new Uint8Array(bytes), { mergePages: true });
    text = extracted.text;
    totalPages = extracted.totalPages;
  } catch {
    throw new InvalidImportError('The PDF could not be read.');
  }

  const markdown = normalizeText(text);
  if (markdown === '') {
    throw new InvalidImportError(
      'The PDF contains no extractable text. Scanned or image-only PDFs are not supported.',
    );
  }

  const firstLine = markdown
    .split('\n')
    .find((line) => line.trim() !== '')
    ?.trim();
  return {
    format: 'pdf',
    mediaType: 'application/pdf',
    entries: [{ title: cleanTitle(firstLine, fileStem(fileName)), markdown }],
    conversionNotes: [
      `Extracted plain text from a ${totalPages}-page PDF; layout, images, and table structure are not preserved.`,
    ],
  };
}
