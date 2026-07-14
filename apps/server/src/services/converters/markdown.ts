import { InvalidImportError } from '../../errors.js';
import type { ConversionResult } from './types.js';
import { cleanTitle, decodeUtf8, fileStem, stripBom } from './text-utils.js';

const HEADING = /^#{1,6}[ \t]+(.+?)[ \t]*#*\s*$/mu;

/**
 * Markdown is the user's own format: decode verbatim (BOM stripped, line endings
 * left as authored) with no semantic rewriting. The title is the first ATX
 * heading if present, otherwise the file name stem.
 */
export function convertMarkdown(bytes: Buffer, fileName: string): ConversionResult {
  const markdown = stripBom(decodeUtf8(bytes)).replace(/\r\n?/gu, '\n');
  if (markdown.trim() === '') {
    throw new InvalidImportError('The Markdown file has no readable content.');
  }
  const heading = HEADING.exec(markdown);
  return {
    format: 'markdown',
    mediaType: 'text/markdown',
    entries: [{ title: cleanTitle(heading?.[1], fileStem(fileName)), markdown }],
    conversionNotes: [],
  };
}
