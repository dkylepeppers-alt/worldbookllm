import { InvalidImportError } from '../../errors.js';
import type { ConversionResult } from './types.js';
import { cleanTitle, decodeUtf8, fileStem, normalizeText } from './text-utils.js';

/**
 * Plain text becomes Markdown through deterministic whitespace normalization
 * only — no heading inference or other guessing. Nothing lossy happens, so no
 * conversion notes are recorded.
 */
export function convertText(bytes: Buffer, fileName: string): ConversionResult {
  const markdown = normalizeText(decodeUtf8(bytes));
  if (markdown === '') {
    throw new InvalidImportError('The text file has no readable content.');
  }
  return {
    format: 'text',
    mediaType: 'text/plain',
    entries: [{ title: cleanTitle(undefined, fileStem(fileName)), markdown }],
    conversionNotes: [],
  };
}
