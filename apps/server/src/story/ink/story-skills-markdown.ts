/**
 * Markdown helpers vendored from story-skills 0.23.0 (`src/markdown.js`),
 * the rules every story-skills build uses to split chapter prose into
 * paragraphs. Kept in step with the pinned package by
 * story-skills-markdown.test.ts, which runs both on the same text.
 *
 * MIT License, Copyright (c) 2026 Daniel Dewhurst.
 */

// A scene break paragraph: three or more of the same marker, optionally
// spaced (`* * *`, `---`, `~~~`), also when Pandoc escapes it (`\* \* \*`), or a
// lone `#` as in Scrivener and manuscript convention.
function isSceneBreak(paragraph: string): boolean {
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
