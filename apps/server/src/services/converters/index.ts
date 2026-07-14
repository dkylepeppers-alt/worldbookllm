import type { SourcePreview } from '@worldbookllm/shared';
import { sourcePreviewSchema } from '@worldbookllm/shared';

import { InvalidImportError } from '../../errors.js';
import { convertHtml } from './html.js';
import { convertJson } from './json.js';
import { MARKDOWN_LIMIT_BYTES, MAX_ENTRIES } from './limits.js';
import { convertMarkdown } from './markdown.js';
import { convertPdf } from './pdf.js';
import { convertText } from './text.js';
import type { ConversionResult } from './types.js';
import { decodeUtf8 } from './text-utils.js';

const PDF_MAGIC = '%PDF-';

function extension(fileName: string): string {
  const match = /\.([^.]+)$/u.exec(fileName.toLowerCase());
  return match?.[1] ?? '';
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trimStart();
  const first = trimmed[0];
  if (first !== '{' && first !== '[') return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

function looksLikeHtml(text: string): boolean {
  return /^\s*<(?:!doctype html|html|head|body)[\s>]/iu.test(text);
}

async function convert(bytes: Buffer, fileName: string): Promise<ConversionResult> {
  if (bytes.byteLength === 0) throw new InvalidImportError('The uploaded file is empty.');

  // PDF is binary; detect it by magic bytes before attempting a text decode.
  if (bytes.subarray(0, PDF_MAGIC.length).toString('latin1') === PDF_MAGIC) {
    return convertPdf(bytes, fileName);
  }

  let text: string;
  try {
    text = decodeUtf8(bytes);
  } catch {
    throw new InvalidImportError('The uploaded file is not a PDF or UTF-8 text.');
  }

  // Content sniffing wins over the extension hint, so a mislabeled file
  // (for example HTML named `.json`) still converts as what it actually is.
  if (looksLikeJson(text)) return convertJson(text, fileName);
  if (looksLikeHtml(text)) return convertHtml(bytes, fileName);

  const ext = extension(fileName);
  if (ext === 'json') return convertJson(text, fileName);
  if (ext === 'html' || ext === 'htm') return convertHtml(bytes, fileName);
  if (ext === 'md' || ext === 'markdown') return convertMarkdown(bytes, fileName);
  return convertText(bytes, fileName);
}

/**
 * Detects the upload format from content (using the file name only as a hint),
 * runs the matching converter, enforces the shared preview limits, and returns a
 * validated `SourcePreview` with a server-built file origin.
 */
export async function convertUpload(bytes: Buffer, fileName: string): Promise<SourcePreview> {
  const result = await convert(bytes, fileName);

  if (result.entries.length > MAX_ENTRIES) {
    throw new InvalidImportError(`The import produced more than ${MAX_ENTRIES} sources.`);
  }
  for (const entry of result.entries) {
    if (Buffer.byteLength(entry.markdown, 'utf8') > MARKDOWN_LIMIT_BYTES) {
      throw new InvalidImportError('A converted source exceeds the 10 MiB Markdown limit.');
    }
  }

  return sourcePreviewSchema.parse({
    format: result.format,
    origin: { type: 'file', fileName, mediaType: result.mediaType },
    entries: result.entries,
    conversionNotes: result.conversionNotes,
  });
}
