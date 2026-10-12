import { chapterTextEnd } from './story-skills-markdown.js';

/**
 * The rules of an interactive book's files (ADR 0030): which chapter is
 * which knot, the order chapters are read in, where a file's ink body
 * starts, and how plain text is written as ink.
 */

/** Words ink reserves, which a knot cannot be named. */
const INK_RESERVED = new Set(['true', 'false', 'not', 'else', 'return', 'temp', 'function']);

/** Where ink that is not a chapter lives: Markdown files whose bodies are ink. */
const INK_DIRECTORY = 'ink';

/** The file conversion writes a book's variables to. */
export const INK_VARIABLES_FILE = `${INK_DIRECTORY}/variables.md`;

/**
 * A chapter id's knot name: `-` becomes `_`, and a name that starts with a
 * digit or is a reserved word takes a leading `_` (`chapter-03` is
 * `chapter_03`, `1-prologue` is `_1_prologue`).
 */
export function inkKnotName(id: string): string {
  const name = id.replace(/-/gu, '_');
  return /^[0-9]/u.test(name) || INK_RESERVED.has(name) ? `_${name}` : name;
}

/** Whether a book file holds ink that is not a chapter. */
export function isInkFile(path: string): boolean {
  return path.startsWith(`${INK_DIRECTORY}/`) && path.endsWith('.md');
}

/** story-skills' `isPositiveIntegerValue`: what a valid `number` field holds. */
function isPositiveInteger(value: unknown): boolean {
  const number = Number(value);
  return (
    value !== '' &&
    value !== null &&
    typeof value !== 'boolean' &&
    Number.isInteger(number) &&
    number > 0
  );
}

/**
 * The number a chapter is ordered by: a valid `number` field, else the
 * number in a `chapter-NN.md` file name, else 0.
 */
function chapterNumber(chapter: { path: string; number: unknown }): number {
  if (chapter.number !== undefined && isPositiveInteger(chapter.number)) {
    return Number(chapter.number);
  }
  const match = /^chapter-(\d+)\.md$/u.exec(chapter.path.split('/').at(-1) ?? '');
  return match ? Number.parseInt(match[1]!, 10) : 0;
}

/** Chapters in reading order: by number, then by file path. */
export function orderChapters<T extends { path: string; number: unknown }>(
  chapters: readonly T[],
): T[] {
  return [...chapters].sort(
    (left, right) =>
      chapterNumber(left) - chapterNumber(right) || left.path.localeCompare(right.path, 'en'),
  );
}

/** story-skills' `isIfid`: a version 4 UUID, which IF archives and players expect. */
export function isIfid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  );
}

const FRONTMATTER = /^\uFEFF?---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/u;

/** Text without the frontmatter it starts with. */
export function withoutFrontmatter(text: string): string {
  return text.replace(FRONTMATTER, '');
}

/** Where a book file's ink is: everything before it as written, the ink, and the line it starts on. */
export interface InkSection {
  /** The file up to the ink, as written: frontmatter, and for a chapter its planning. */
  head: string;
  /** The ink, with `\n` line endings. */
  ink: string;
  /** The 1-based line of the file the ink starts on. */
  firstLine: number;
}

/**
 * A book file's ink (ADR 0030). A chapter keeps story-skills' layout: its
 * planning (an outline, notes) is Markdown, and its ink is the section
 * under `## Chapter Text`, or the whole body when it has no such heading.
 * An `ink/` file's ink is its whole body.
 */
export function inkSection(text: string, kind: 'chapter' | 'ink'): InkSection {
  const frontmatter = FRONTMATTER.exec(text)?.[0] ?? (text.startsWith('\uFEFF') ? '\uFEFF' : '');
  const body = text.slice(frontmatter.length);
  const end = kind === 'chapter' ? chapterTextEnd(body) : null;
  let cut = frontmatter.length;
  if (end !== null) {
    cut += end;
    // The heading's own line break belongs to the head.
    const rest = text.slice(cut);
    cut += rest.startsWith('\r\n') ? 2 : rest.startsWith('\n') ? 1 : 0;
  }
  const head = text.slice(0, cut);
  return {
    head,
    ink: text.slice(cut).replace(/\r\n?/gu, '\n'),
    firstLine: (head.match(/\n/gu)?.length ?? 0) + 1,
  };
}

/**
 * Plain text as ink that prints it: a backslash before what ink would read
 * as markup. `\` escapes, `{ } |` are logic and alternatives, `#` starts a
 * tag, `[ ]` split choice text, `~` is logic, `->` diverts, `<-` threads,
 * `<>` is glue, and `//` and `/*` start comments.
 */
export function inkText(text: string): string {
  return text.replace(/[\\{}|#[\]~]|-(?=>)|<(?=[>-])/gu, '\\$&').replace(/\/(?=[/*])/gu, '/\\');
}

/**
 * A line of plain text as ink: escaped, and with a backslash before what
 * would start a choice, gather, knot, or statement. ink drops leading
 * whitespace, so the line starts at its text.
 */
export function inkLine(line: string): string {
  const text = inkText(line.trim());
  return /^[*+\-=]|^(?:INCLUDE|VAR|CONST|LIST|EXTERNAL|TODO)\b/u.test(text) ? `\\${text}` : text;
}

/** A `# name: value` tag; a tag runs to the end of its line, so its value is one line. */
export function inkTag(name: string, value: string): string {
  return `# ${name}: ${inkText(value.replace(/\s+/gu, ' ').trim())}`;
}
