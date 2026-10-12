/**
 * Markdown helpers vendored from story-skills 0.23.0 (`src/markdown.js`),
 * the rules every story-skills build uses to split chapter prose into
 * paragraphs. worldbookllm converts Markdown chapters to ink with the same
 * rules (`markdown-to-ink.ts`), so a converted book reads as it did.
 *
 * MIT License, Copyright (c) 2026 Daniel Dewhurst.
 */

// A scene break paragraph: three or more of the same marker, optionally
// spaced (`* * *`, `---`, `~~~`), also when Pandoc escapes it (`\* \* \*`), or a
// lone `#` as in Scrivener and manuscript convention.
export function isSceneBreak(paragraph: string): boolean {
  const text = paragraph.replace(/\\([*_~-])/gu, '$1').trim();
  return text === '#' || /^([*_~-])( ?\1){2,}$/u.test(text);
}

// Each run of layout whitespace as one space.
function collapseSourceSpace(text: string): string {
  return text.replace(/[ \t\n\v\f\r\u2028\u2029]+/gu, ' ');
}

// Each typed space as a plain one; layout whitespace is left as it is.
function plainSpaces(text: string): string {
  return text.replace(/[^\S \t\n\v\f\r\u2028\u2029]/gu, ' ');
}

/** A line (or paragraph) that is a scene break, also one spaced with typed spaces. */
function isSceneBreakLine(line: string): boolean {
  return isSceneBreak(collapseSourceSpace(plainSpaces(line)));
}

/** A scene-break line that ends the paragraph above it and starts a new one below. */
function breaksParagraph(line: string): boolean {
  return /^ {0,3}[^ \t]/u.test(line) && isSceneBreakLine(line);
}

/** An ATX heading line, as story-skills' flattenHeadings reads one. */
export function isHeadingLine(line: string): boolean {
  return /^#+(?:[ \t]|$)/u.test(line);
}

// [opening line, closing line] index pairs of the closed backtick fences.
function closedFences(lines: readonly string[]): [number, number][] {
  const fences: [number, number][] = [];
  let open: { index: number; fence: string } | null = null;
  for (const [index, line] of lines.entries()) {
    const marker = /^ {0,3}(`{3,})/u.exec(line);
    if (!marker) continue;
    if (open === null) {
      open = { index, fence: marker[1]! };
    } else if (marker[1]!.length >= open.fence.length && line.trim() === marker[1]) {
      fences.push([open.index, index]);
      open = null;
    }
  }
  return fences;
}

/** Line indexes inside closed backtick code fences, fence lines included. */
export function fencedLineIndexes(lines: readonly string[]): Set<number> {
  const fenced = new Set<number>();
  for (const [start, end] of closedFences(lines)) {
    for (let inside = start; inside <= end; inside += 1) fenced.add(inside);
  }
  return fenced;
}

/**
 * The text with a blank line above and below each line that breaks a
 * paragraph, for builds that split prose into paragraphs at blank lines.
 * Lines between closed backtick fences are code, never a break.
 */
export function separateSceneBreaks(text: string): string {
  const lines = text.split('\n');
  const code = fencedLineIndexes(lines.map((line) => line.replace(/\r$/u, '')));
  const blank = (line: string) => /^[ \t\r]*$/u.test(line);
  const out: string[] = [];
  for (const [index, line] of lines.entries()) {
    const breaks = !code.has(index) && breaksParagraph(line);
    if (breaks && out.length > 0 && !blank(out.at(-1)!)) out.push('');
    out.push(line);
    if (breaks && index < lines.length - 1 && !blank(lines[index + 1]!)) out.push('');
  }
  return out.join('\n');
}

// Han, kana, and the rest of what Chinese and Japanese set without spaces
// between words (Korean, set with spaces, is not among them).
const CJK_CHARACTER =
  /^[\u2e80-\u2fff\u3000-\u30ff\u3190-\u319f\u31c0-\u31ff\u3220-\u325f\u3280-\u33ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\ufe10-\ufe1f\ufe30-\ufe4f\uff01-\uff9f\uffe0-\uffee\u{1b000}-\u{1b16f}\u{20000}-\u{3ffff}]$/u;
// Punctuation Chinese and Japanese set at full width: middle dot, dashes,
// ellipses, and curly quotes.
const WIDE_PUNCTUATION = /^[\u00b7\u2014\u2015\u2018\u2019\u201c\u201d\u2025\u2026]$/u;
// Combining marks and variation selectors, which belong to the character before them.
// Each is tested on its own (see lastCharacter), so a mark is never misread as joined.
/* eslint-disable no-misleading-character-class */
const COMBINING =
  /^[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\u302a-\u302f\u3099\u309a\ufe00-\ufe0f\ufe20-\ufe2f\u{e0100}-\u{e01ef}]$/u;
/* eslint-enable no-misleading-character-class */

// The last character of a line, past combining marks and variation selectors.
function lastCharacter(text: string): string {
  let end = text.length;
  while (end > 0) {
    const pair =
      end > 1 && /[\udc00-\udfff]/u.test(text[end - 1]!) && /[\ud800-\udbff]/u.test(text[end - 2]!);
    const character = text.slice(end - (pair ? 2 : 1), end);
    if (!COMBINING.test(character)) return character;
    end -= character.length;
  }
  return '';
}

/**
 * What a soft line break between two lines of one paragraph becomes:
 * nothing between two Chinese or Japanese characters (or one of them and
 * full-width punctuation beside it), otherwise a space.
 */
export function softBreak(before: string, after: string): string {
  const left = lastCharacter(before);
  const first = after.codePointAt(0);
  const right = first === undefined ? '' : String.fromCodePoint(first);
  const cjkLeft = CJK_CHARACTER.test(left);
  const cjkRight = CJK_CHARACTER.test(right);
  return (cjkLeft && (cjkRight || WIDE_PUNCTUATION.test(right))) ||
    (cjkRight && WIDE_PUNCTUATION.test(left))
    ? ''
    : ' ';
}

// Where a chapter's prose starts, as story-skills reads chapters (its
// `proseStart` and `scanMarkup`): after a `## Chapter Text` heading; else
// after an outline's divider; else after one leading heading. Headings in
// code or comments do not count.

interface MarkupRange {
  kind: 'fence' | 'comment';
  start: number;
  end: number;
}

function fenceCloser(text: string): (openerEnd: number, length: number) => number {
  const closers: { start: number; end: number; length: number }[] = [];
  for (let lineStart = 0; lineStart < text.length;) {
    const next = text.indexOf('\n', lineStart);
    const lineEnd = next === -1 ? text.length : next;
    const line = text.slice(lineStart, lineEnd);
    const marker = /^ {0,3}(`{3,})/u.exec(line);
    if (marker && line.trim() === marker[1]) {
      closers.push({
        start: lineStart,
        end: Math.min(lineEnd + 1, text.length),
        length: marker[1]!.length,
      });
    }
    lineStart = lineEnd + 1;
  }
  const longest = closers.map((closer) => closer.length);
  for (let index = longest.length - 2; index >= 0; index -= 1) {
    longest[index] = Math.max(longest[index]!, longest[index + 1]!);
  }
  let first = 0;
  return (openerEnd, length) => {
    while (first < closers.length && closers[first]!.start <= openerEnd) first += 1;
    if (first === closers.length || longest[first]! < length) return -1;
    let index = first;
    while (closers[index]!.length < length) index += 1;
    return closers[index]!.end;
  };
}

function codeSpanCloser(text: string, limit: number): (start: number, length: number) => number {
  const last = new Map<number, number>();
  let scanned = false;
  return (start, length) => {
    if (scanned && !((last.get(length) ?? -1) > start)) return -1;
    let search = start + length;
    while (search < limit) {
      const next = text.indexOf('`', search);
      if (next === -1 || next >= limit) break;
      let end = next;
      while (text[end] === '`') end += 1;
      if (end - next === length) return end;
      if (!scanned) last.set(end - next, next);
      search = end;
    }
    scanned = true;
    return -1;
  };
}

/** Fenced code blocks and HTML comments, as character ranges. */
export function scanMarkup(text: string): MarkupRange[] {
  const ranges: MarkupRange[] = [];
  let fences: ((openerEnd: number, length: number) => number) | null = null;
  let closeSpan: ((start: number, length: number) => number) | null = null;
  let nextOpen = -2;
  let nextTick = -2;
  let lineEnd = -1;
  let position = 0;
  while (position < text.length) {
    if (position > lineEnd) {
      const newline = text.indexOf('\n', position);
      lineEnd = newline === -1 ? text.length : newline;
      closeSpan = null;
    }
    if (position === 0 || text[position - 1] === '\n') {
      const marker = /^ {0,3}(`{3,})/u.exec(text.slice(position, lineEnd));
      if (marker) {
        fences ??= fenceCloser(text);
        const end = fences(lineEnd, marker[1]!.length);
        if (end !== -1) {
          ranges.push({ kind: 'fence', start: position, end });
          position = end;
          continue;
        }
      }
    }
    if (nextOpen !== -1 && nextOpen < position) nextOpen = text.indexOf('<!--', position);
    if (nextTick !== -1 && nextTick < position) nextTick = text.indexOf('`', position);
    const open = nextOpen !== -1 && nextOpen < lineEnd ? nextOpen : -1;
    const tick = nextTick;
    if (tick !== -1 && tick < lineEnd && (open === -1 || tick < open)) {
      let runEnd = tick;
      while (text[runEnd] === '`') runEnd += 1;
      closeSpan ??= codeSpanCloser(text, lineEnd);
      const end = closeSpan(tick, runEnd - tick);
      position = end === -1 ? runEnd : end;
      continue;
    }
    if (open === -1) {
      position = lineEnd + 1;
      continue;
    }
    const close = text.indexOf('-->', open + 4);
    if (close === -1) {
      nextOpen = -1;
      position = open + 4;
      continue;
    }
    ranges.push({ kind: 'comment', start: open, end: close + 3 });
    position = close + 3;
  }
  return ranges;
}

function maskMarkup(text: string): string {
  let result = '';
  let position = 0;
  for (const range of scanMarkup(text)) {
    result +=
      text.slice(position, range.start) +
      text.slice(range.start, range.end).replace(/[^\r\n]/gu, ' ');
    position = range.end;
  }
  return result + text.slice(position);
}

function sectionHeading(heading: string): RegExp {
  return new RegExp(`^ {0,3}##[ \\t]+${heading}(?:[ \\t]+#+)?[ \\t]*\\r?$`, 'imu');
}

function outlineDivider(masked: string, start: number): number | null {
  const lines = masked.slice(start).split('\n');
  let offset = start + lines[0]!.length + 1;
  let previous = 'blank';
  for (const line of lines.slice(1)) {
    const lineStart = offset;
    offset += line.length + 1;
    const text = line.replace(/\r$/u, '');
    if (text.trim() === '') {
      previous = 'blank';
    } else if (text.trim() === '---') {
      return lineStart + line.length;
    } else if (
      /^\s*(?:[-*+]|\d+[.)])(?:[ \t]|$)/u.test(text) ||
      /^ {0,3}#{2,}(?:[ \t]|$)/u.test(text) ||
      /^[ \t]+\S/u.test(text)
    ) {
      previous = 'outline';
    } else if (previous !== 'outline') {
      return null;
    }
  }
  return null;
}

function leadingHeadingLength(masked: string): number {
  const match =
    /^(?:[ \t]*\r?\n)*(?:[ \t]{0,3}#(?!#)[ \t]+[^\r\n]*|[ \t]{0,3}\S[^\r\n]*\r?\n[ \t]{0,3}=+[ \t]*)(?:\r?\n|$)/u.exec(
      masked,
    );
  return match ? match[0].length : 0;
}

/** The offset just past a `## Chapter Text` heading line, or null without one. */
export function chapterTextEnd(body: string): number | null {
  const match = sectionHeading('Chapter Text').exec(maskMarkup(body));
  return match === null ? null : match.index + match[0].length;
}

/** The offset in a chapter body where its prose starts. */
export function proseStart(body: string): number {
  const masked = maskMarkup(body);
  const chapterText = sectionHeading('Chapter Text').exec(masked);
  if (chapterText) return chapterText.index + chapterText[0].length;
  const outline = sectionHeading('Outline').exec(masked);
  if (!outline) return leadingHeadingLength(masked);
  const start = outline.index + outline[0].length;
  return outlineDivider(masked, start) ?? start;
}
