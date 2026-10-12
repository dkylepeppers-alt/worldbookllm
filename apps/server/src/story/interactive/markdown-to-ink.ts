/**
 * A chapter's Markdown prose as ink lines, for converting a book to ink
 * chapters (ADR 0030). ink prints each line as a paragraph, so the lines of
 * a Markdown paragraph are joined as story-skills' builds read prose
 * (`story-skills-markdown.ts`), and what ink would read as markup is
 * escaped so the text prints as written. A scene break becomes the tag
 * line `# break`.
 */

import { inkLine } from './format.js';
import {
  fencedLineIndexes,
  isHeadingLine,
  isSceneBreak,
  separateSceneBreaks,
  softBreak,
} from './story-skills-markdown.js';

// A line ending in two spaces or a backslash is a hard break (the backslash
// dropped). The spaces match only from the start of a run.
const HARD_BREAK = /(?:(?<! ) {2,}|(?:^|[^\\])(?:\\\\)*\\)$/u;

const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/u;
const QUOTE = /^ {0,3}>/u;
const TABLE_ROW = /^ {0,3}\|/u;

/** A line that starts a block of its own rather than continuing a paragraph. */
function startsBlock(line: string, previous: string): boolean {
  if (isHeadingLine(previous) || TABLE_ROW.test(previous)) return true;
  if (isHeadingLine(line) || LIST_ITEM.test(line) || TABLE_ROW.test(line)) return true;
  return QUOTE.test(line) && !QUOTE.test(previous);
}

/**
 * Prose as ink lines. ink prints each source line as a paragraph, so the
 * lines of a Markdown paragraph are joined as the other builds read prose: a
 * blank line or a scene-break line ends a paragraph, a soft break is a space
 * except between Chinese or Japanese characters, and a hard break keeps
 * verse on its lines. Unlike story-skills' ink build, a heading, list item,
 * quotation, or table row keeps its own line, a quotation's following lines
 * join it without their `>`, and code in a closed fence keeps every line.
 */
export function markdownToInk(body: string): string[] {
  const out: string[] = [];
  const separated = separateSceneBreaks(body).replace(/\r\n?/gu, '\n');
  const allLines = separated.split('\n');
  const code = fencedLineIndexes(allLines);
  let pieces: string[] = [];
  let previous: { line: string; text: string } | null = null;
  const flush = () => {
    if (pieces.length > 0) {
      const text = pieces.join('');
      out.push(isSceneBreak(text) ? '# break' : inkLine(text));
    }
    pieces = [];
    previous = null;
  };

  allLines.forEach((line, index) => {
    if (code.has(index)) {
      flush();
      if (line.trim() !== '') out.push(inkLine(line));
      return;
    }
    if (line.trim() === '') {
      flush();
      if (out.at(-1) !== '') out.push('');
      return;
    }
    const next = allLines[index + 1];
    const last = next === undefined || next.trim() === '' || code.has(index + 1);
    const broken = !last && HARD_BREAK.test(line);
    let text = (broken ? line.replace(/\\$/u, '') : line).trim();
    if (previous !== null && startsBlock(line, previous.line)) flush();
    if (previous !== null) {
      // A quotation's next line joins it without its own `>`.
      if (QUOTE.test(line) && QUOTE.test(previous.line)) text = text.replace(/^>\s?/u, '');
      pieces.push(softBreak(previous.text, text));
    }
    pieces.push(text);
    previous = { line, text };
    if (broken) flush();
  });
  flush();
  while (out.at(-1) === '') out.pop();
  return out;
}
