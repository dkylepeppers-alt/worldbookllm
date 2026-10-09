/**
 * worldbookllm's ink writer (ADR 0028): the book as ink source for inkle's
 * tools (Inky, inklecate, inkjs), with one knot per chapter.
 *
 * It starts from story-skills 0.23.0's ink build (`src/ink.js`, MIT License,
 * Copyright (c) 2026 Daniel Dewhurst): the same knot names, escaping,
 * global tags, sticky choices, and endings, so a book that uses none of the
 * additions below plays exactly as story-skills' build does
 * (ink-writer.test.ts checks this against the pinned package). On top of it:
 *
 * - Block lines keep their own line. A heading, list item, quotation, table
 *   row, or fenced code line is never run into the paragraph around it.
 * - Each knot opens with a `# chapter: Title` knot tag, which players read
 *   with `TagsForContentAtPath` (inkle's "Running your ink", Knot tags).
 * - Choices can set and require state: `sets` becomes `~ flag = true`,
 *   `requires` a condition before the choice text, and a chapter id in
 *   `requires` tests that chapter's read count ("Writing with ink", Part 1
 *   §7 Conditional Choices and Part 3 Variables and Logic).
 *
 * Syntax follows inkle's "Writing with ink": a backslash makes the next
 * character plain text.
 */

import {
  fencedLineIndexes,
  isHeadingLine,
  separateSceneBreaks,
  softBreak,
} from './story-skills-markdown.js';

interface InkChoice {
  text: string;
  /** The chapter id it leads to. */
  to: string;
  /** Flags the choice sets: `name` sets it true, `not name` false. */
  sets: readonly string[];
  /** All must hold: `name`, `not name`, or a chapter id for "has read it". */
  requires: readonly string[];
}

export interface InkPassage {
  /** The chapter id. */
  id: string;
  title: string;
  /** The chapter prose as Markdown, as the build assembles it. */
  body: string;
  choices: readonly InkChoice[];
}

export interface InkStory {
  title: string;
  author: string;
  ifid: string;
  /** With no choices anywhere, each chapter diverts to the next. */
  branching: boolean;
  passages: readonly InkPassage[];
}

// ink reserved words a knot or variable name cannot be, as story-skills
// guards knot names, plus the flow and logic words of "Writing with ink".
const INK_RESERVED = new Set(['true', 'false', 'not', 'else', 'return', 'temp', 'function']);
const FLAG_RESERVED = new Set([
  ...INK_RESERVED,
  'and',
  'or',
  'mod',
  'has',
  'hasnt',
  'END',
  'DONE',
  'VAR',
  'CONST',
  'LIST',
  'INCLUDE',
  'EXTERNAL',
  'TODO',
]);

/** ASCII ink identifiers; ink accepts some other scripts, but flags stay portable. */
const FLAG_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;

/**
 * A chapter id's knot name, as story-skills names it: `-` becomes `_`, and
 * a name that starts with a digit or is reserved takes a leading `_`.
 */
export function inkKnotName(id: string): string {
  const name = id.replace(/-/gu, '_');
  return /^[0-9]/u.test(name) || INK_RESERVED.has(name) ? `_${name}` : name;
}

/** A `sets`/`requires` entry split into its name and whether it is negated. */
export function parseFlag(entry: string): { name: string; negated: boolean } {
  const match = /^not\s+(.+)$/u.exec(entry.trim());
  return match ? { name: match[1]!.trim(), negated: true } : { name: entry.trim(), negated: false };
}

/**
 * Why a flag name cannot be used, or null. A flag shares ink's namespace
 * with the knots, so it cannot be a chapter's knot name either.
 */
export function flagProblem(name: string, knots: ReadonlySet<string>): string | null {
  if (!FLAG_NAME.test(name)) {
    return `${name} is not a flag name: use letters, digits, and underscores, starting with a letter`;
  }
  if (FLAG_RESERVED.has(name)) return `${name} is a word ink reserves`;
  if (knots.has(name)) return `${name} is a chapter's knot name in ink`;
  return null;
}

// Characters that mean something anywhere in a line: `\` escapes, `{ } |`
// are logic and alternatives, `#` starts a tag, `[ ]` split choice text,
// `~` is logic, `->` diverts, `<-` threads, `<>` is glue. `//` and `/*`
// start comments, so a backslash goes between the two characters.
function inkInline(text: string): string {
  return text.replace(/[\\{}|#[\]~]|-(?=>)|<(?=[>-])/gu, '\\$&').replace(/\/(?=[/*])/gu, '/\\');
}

// At the start of a line `*` and `+` open a choice, `-` a gather, `=` a knot
// or stitch, and INCLUDE, VAR, CONST, LIST, EXTERNAL, and TODO are
// statements. ink drops leading whitespace, so the line starts at its text.
function inkLine(line: string): string {
  const text = inkInline(line.trim());
  return /^[*+\-=]|^(?:INCLUDE|VAR|CONST|LIST|EXTERNAL|TODO)\b/u.test(text) ? `\\${text}` : text;
}

// A tag runs to the end of its line, so its value is one line.
function inkTag(name: string, value: string): string {
  return `# ${name}: ${inkInline(value.replace(/\s+/gu, ' ').trim())}`;
}

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
function inkProse(body: string): string[] {
  const out: string[] = [];
  const separated = separateSceneBreaks(body).replace(/\r\n?/gu, '\n');
  const allLines = separated.split('\n');
  const code = fencedLineIndexes(allLines);
  let pieces: string[] = [];
  let previous: { line: string; text: string } | null = null;
  const flush = () => {
    if (pieces.length > 0) out.push(inkLine(pieces.join('')));
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

/** The condition before a choice's text: `{flag}`, `{not flag}`, `{chapter_03}`. */
function condition(entry: string, chapters: ReadonlySet<string>): string {
  const { name, negated } = parseFlag(entry);
  const target = chapters.has(name) ? inkKnotName(name) : name;
  return `{${negated ? 'not ' : ''}${target}}`;
}

/**
 * Every flag the story sets or tests, in first-use order: each name in
 * `sets`, and each name in `requires` that is not a chapter id (those test
 * the chapter's read count instead).
 */
export function storyFlags(story: InkStory): string[] {
  const chapters = new Set(story.passages.map((passage) => passage.id));
  const flags = new Set<string>();
  for (const passage of story.passages) {
    for (const choice of passage.choices) {
      for (const entry of choice.requires) {
        const { name } = parseFlag(entry);
        if (!chapters.has(name)) flags.add(name);
      }
      for (const entry of choice.sets) flags.add(parseFlag(entry).name);
    }
  }
  return [...flags];
}

/** The book as ink source. */
export function inkSource(story: InkStory): string {
  const chapters = new Set(story.passages.map((passage) => passage.id));
  const lines = [inkTag('title', story.title)];
  if (story.author.trim() !== '') lines.push(inkTag('author', story.author));
  lines.push(inkTag('ifid', story.ifid.toUpperCase()), '');

  const flags = story.branching ? storyFlags(story) : [];
  if (flags.length > 0) {
    lines.push(...flags.map((flag) => `VAR ${flag} = false`), '');
  }
  const first = story.passages[0];
  if (first !== undefined) lines.push(`-> ${inkKnotName(first.id)}`, '');

  story.passages.forEach((passage, position) => {
    lines.push(`=== ${inkKnotName(passage.id)} ===`);
    lines.push(inkTag('chapter', passage.title));
    if (passage.body !== '') lines.push(...inkProse(passage.body), '');
    if (!story.branching) {
      const next = story.passages[position + 1];
      lines.push(`-> ${next ? inkKnotName(next.id) : 'END'}`);
    } else if (passage.choices.length === 0) {
      lines.push('-> END');
    } else {
      // Sticky choices, like Twine links: a chapter the reader comes back
      // to offers every choice again whose conditions still hold.
      for (const choice of passage.choices) {
        const conditions = choice.requires
          .map((entry) => `${condition(entry, chapters)} `)
          .join('');
        const target = inkKnotName(choice.to);
        if (choice.sets.length === 0) {
          lines.push(`+ ${conditions}[${inkInline(choice.text)}] -> ${target}`);
        } else {
          lines.push(`+ ${conditions}[${inkInline(choice.text)}]`);
          for (const entry of choice.sets) {
            const { name, negated } = parseFlag(entry);
            lines.push(`    ~ ${name} = ${negated ? 'false' : 'true'}`);
          }
          lines.push(`    -> ${target}`);
        }
      }
    }
    lines.push('');
  });
  return `${lines.join('\n').trimEnd()}\n`;
}
