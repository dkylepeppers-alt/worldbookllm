import { Readability } from '@mozilla/readability';
import { gfm } from '@joplin/turndown-plugin-gfm';
import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';

import { InvalidImportError } from '../../errors.js';
import type { ConversionResult } from './types.js';
import { cleanTitle, decodeUtf8, fileStem, stripBom } from './text-utils.js';

const BOILERPLATE = 'script, style, noscript, template, iframe';

type ParsedDocument = ReturnType<typeof parseHTML>['document'];

/**
 * linkedom does not wrap loose top-level content in `<body>` the way a browser
 * does, so a bodyless fragment would parse into an empty body. Wrap anything
 * without an `<html>`/`<body>` in a minimal document skeleton first.
 */
function ensureDocument(html: string): string {
  return /<(?:html|body)[\s>]/iu.test(html)
    ? html
    : `<!doctype html><html><body>${html}</body></html>`;
}

function toMarkdown(html: string): string {
  const service = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
  service.use(gfm);
  return service
    .turndown(html)
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function firstHeadingText(document: ParsedDocument): string | undefined {
  const heading = document.querySelector('h1');
  const text = heading?.textContent?.trim();
  return text === undefined || text === '' ? undefined : text;
}

/**
 * HTML is reduced to its primary content where practical. Readability isolates
 * the article; when it cannot (or keeps too little of the page), we fall back to
 * the full document body with scripts, styles, and other non-content elements
 * removed. The chosen HTML is converted to GitHub-flavored Markdown so tables
 * survive. Conversion notes record which path was taken.
 */
export function convertHtml(bytes: Buffer, fileName: string): ConversionResult {
  const html = ensureDocument(stripBom(decodeUtf8(bytes)));
  const { document } = parseHTML(html);
  const documentTitle = document.querySelector('title')?.textContent?.trim();

  // Readability mutates the document it parses, so give it a fresh copy and keep
  // `document` intact for the fallback path.
  let article: ReturnType<Readability['parse']> = null;
  try {
    article = new Readability(parseHTML(html).document).parse();
  } catch {
    article = null;
  }

  const articleText = article?.textContent?.replace(/\s+/gu, ' ').trim() ?? '';

  let sourceHtml: string;
  const conversionNotes: string[] = [];
  if (article?.content != null && articleText !== '') {
    sourceHtml = article.content;
    conversionNotes.push(
      'Extracted the main article content; navigation and boilerplate were removed.',
    );
  } else {
    for (const node of document.querySelectorAll(BOILERPLATE)) node.remove();
    sourceHtml = document.body?.innerHTML ?? html;
    conversionNotes.push('Could not isolate the main content; converted the full page body.');
  }

  const markdown = toMarkdown(sourceHtml);
  if (markdown === '') {
    throw new InvalidImportError('The HTML page has no readable content.');
  }

  const title = cleanTitle(
    article?.title?.trim() || documentTitle || firstHeadingText(document),
    fileStem(fileName),
  );
  return {
    format: 'html',
    mediaType: 'text/html',
    entries: [{ title, markdown }],
    conversionNotes,
  };
}
