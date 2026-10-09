import type { BookBranches, BranchChapter, ChapterChoice } from '@worldbookllm/shared';
import { CHOICE_TEXT_UNSAFE } from '@worldbookllm/shared';
import matter from 'gray-matter';

import { ConflictError } from '../errors.js';

/** A chapter file as the branch graph reads it. */
export interface ChapterSource {
  id: string;
  title: string;
  path: string;
  hash: string;
  frontmatter: Record<string, unknown> | null;
}

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

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
 * The number story-skills 0.23.0 orders a chapter by (`chapterNumber` in its
 * scan.js): a valid `number` field, else the number in a `chapter-NN.md` file
 * name, else 0.
 */
function chapterNumber(chapter: ChapterSource): number {
  const value = chapter.frontmatter?.number;
  if (value !== undefined && isPositiveInteger(value)) return Number(value);
  const match = /^chapter-(\d+)\.md$/u.exec(chapter.path.split('/').at(-1) ?? '');
  return match ? Number.parseInt(match[1]!, 10) : 0;
}

/** story-skills' `isIfid`: the builds accept only a version 4 UUID. */
export function isIfid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  );
}

/**
 * A chapter's `choices`, read the way story-skills 0.23.0 reads them
 * (`chapterChoices` in its scan.js): well-formed entries, and a description
 * of each malformed one, which the builds refuse.
 */
function readChoices(frontmatter: Record<string, unknown> | null): {
  choices: { text: string; to: string }[];
  problems: string[];
} {
  const value = frontmatter?.choices;
  if (value === undefined || value === null) return { choices: [], problems: [] };
  if (!Array.isArray(value)) {
    return { choices: [], problems: ['choices must be a list of { text, to } entries'] };
  }
  const choices: { text: string; to: string }[] = [];
  const problems: string[] = [];
  value.forEach((entry: unknown, index) => {
    const at = `Choice ${index + 1}`;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      problems.push(`${at} must have text and to`);
      return;
    }
    const record = entry as Record<string, unknown>;
    const text = typeof record.text === 'string' ? record.text.trim() : '';
    const to = typeof record.to === 'string' ? record.to : '';
    const before = problems.length;
    if (text === '') problems.push(`${at} needs text: the words the reader picks`);
    else if (CHOICE_TEXT_UNSAFE.test(text)) {
      problems.push(`${at} text cannot contain [, ], |, ->, <-, or a line break, or end in <`);
    }
    if (to.trim() === '') problems.push(`${at} needs to: the chapter it leads to`);
    else if (!KEBAB.test(to)) problems.push(`${at} leads to ${to}, which is not a chapter id`);
    if (problems.length === before) choices.push({ text, to });
  });
  return { choices, problems };
}

/**
 * The book's chapters as a branch graph, mirroring story-skills' `branchGraph`:
 * the first chapter is the start; with no choices anywhere each chapter runs
 * on to the next; once any chapter has a choice, a chapter's links are its
 * choices and one without them is an ending.
 */
export function branchGraph(sources: readonly ChapterSource[], ifid: unknown): BookBranches {
  const ordered = [...sources].sort(
    (left, right) =>
      chapterNumber(left) - chapterNumber(right) || left.path.localeCompare(right.path, 'en'),
  );
  const parsed = ordered.map((source) => ({ source, ...readChoices(source.frontmatter) }));
  const branching = parsed.some((entry) => entry.choices.length > 0);
  const ids = new Set(ordered.map((source) => source.id));

  const links = new Map<string, string[]>(
    parsed.map((entry, position) => [
      entry.source.id,
      branching
        ? entry.choices.map((choice) => choice.to).filter((to) => ids.has(to))
        : ordered.slice(position + 1, position + 2).map((next) => next.id),
    ]),
  );
  const reached = new Set<string>();
  const start = ordered[0]?.id;
  if (start !== undefined) {
    const queue = [start];
    reached.add(start);
    for (let current = queue.shift(); current !== undefined; current = queue.shift()) {
      for (const to of links.get(current) ?? []) {
        if (!reached.has(to)) {
          reached.add(to);
          queue.push(to);
        }
      }
    }
  }

  const chapters: BranchChapter[] = parsed.map(({ source, choices, problems }) => ({
    id: source.id,
    title: source.title,
    path: source.path,
    hash: source.hash,
    choices,
    problems,
    start: source.id === start,
    ending: branching && choices.length === 0,
    reachable: reached.has(source.id),
  }));
  const present = ifid !== undefined && ifid !== null && ifid !== '';
  return {
    branching,
    ifid: isIfid(ifid) ? ifid : null,
    invalidIfid: present && !isIfid(ifid) ? String(ifid) : null,
    chapters,
  };
}

/** The `choices` block as YAML; JSON strings are valid double-quoted YAML scalars. */
function choicesYaml(choices: readonly ChapterChoice[]): string[] {
  return [
    'choices:',
    ...choices.flatMap((choice) => [
      `  - text: ${JSON.stringify(choice.text)}`,
      `    to: ${choice.to}`,
    ]),
  ];
}

/** A line inside a top-level key's block value: indented, a list item, or blank. */
function continues(line: string): boolean {
  return line.trim() === '' || /^[ \t]/u.test(line) || /^-(?:[ \t]|$)/u.test(line);
}

/**
 * Replaces the `choices` field in a chapter's frontmatter, leaving every other
 * line as written; an empty list removes the field. If the edit would not
 * parse back to exactly the intended frontmatter (unusual YAML around the
 * field), the frontmatter is rewritten whole instead.
 */
export function setFrontmatterChoices(markdown: string, choices: readonly ChapterChoice[]): string {
  const original = parsedData(markdown);
  if (original === null) {
    throw new ConflictError(
      'frontmatter_unreadable',
      'The chapter frontmatter could not be read; fix its YAML before editing choices.',
    );
  }
  const match = /^---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/u.exec(markdown);
  if (match === null && choices.length === 0) return markdown;
  const body = match === null ? markdown : markdown.slice(match[0].length);
  const lines = match?.[1] === undefined ? [] : match[1].split(/\r?\n/u);

  const at = lines.findIndex((line) => /^choices[ \t]*:/u.test(line));
  let end = at + 1;
  if (at !== -1) {
    while (end < lines.length && continues(lines[end]!)) end += 1;
    // Blank lines before the next key belong between the fields, not to choices.
    while (end > at + 1 && lines[end - 1]!.trim() === '') end -= 1;
  }
  const block = choices.length === 0 ? [] : choicesYaml(choices);
  const edited =
    at === -1 ? [...lines, ...block] : [...lines.slice(0, at), ...block, ...lines.slice(end)];
  const result = `---\n${edited.join('\n')}\n---\n${body}`;

  const intended = { ...original };
  delete intended.choices;
  if (choices.length > 0) intended.choices = choices.map(({ text, to }) => ({ text, to }));
  const reparsed = parsedData(result);
  if (reparsed !== null && sameData(reparsed, intended)) return result;
  return matter.stringify(body, intended);
}

/** The frontmatter as data ({} without any), or null when its YAML does not parse. */
function parsedData(markdown: string): Record<string, unknown> | null {
  try {
    // A copy, so gray-matter's cache never shares objects with the caller.
    return structuredClone(matter(markdown).data as Record<string, unknown>);
  } catch {
    return null;
  }
}

function sameData(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value instanceof Date
        ? value.toISOString()
        : typeof value === 'object' && value !== null
          ? Object.fromEntries(
              Object.entries(value)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, entry]) => [key, canonical(entry)]),
            )
          : value;
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}
