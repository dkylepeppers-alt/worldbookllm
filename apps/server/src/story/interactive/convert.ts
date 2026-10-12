import { randomUUID } from 'node:crypto';

import type { ClosingChoice } from '@worldbookllm/shared';

import { parseFrontmatter } from '../book-index.js';
import { removeFrontmatterField, setFrontmatterField } from '../frontmatter-edit.js';
import { choiceLines } from './ending.js';
import { INK_VARIABLES_FILE, inkKnotName, isIfid, orderChapters } from './format.js';
import { markdownToInk } from './markdown-to-ink.js';
import { chapterTextEnd, proseStart, scanMarkup } from './story-skills-markdown.js';

/**
 * Converts a book to ink chapters (ADR 0030): each chapter's Markdown
 * becomes ink that prints the same prose, its frontmatter `choices` (the
 * earlier format, ADR 0027 and 0028) become ink choices, a book without
 * choices diverts chapter to chapter, flags become `VAR`s, and story.md says
 * `interactive: true` with an IFID.
 */

interface ConvertChapter {
  id: string;
  path: string;
  number: unknown;
  /** The whole file, frontmatter included. */
  text: string;
}

export interface ConvertInput {
  story: string;
  chapters: readonly ConvertChapter[];
  /** `ink/variables.md` as it is, or null when the book has none. */
  variables: string | null;
}

export interface ConvertedFile {
  path: string;
  before: string | null;
  after: string;
}

interface LegacyChoice {
  text: string;
  to: string;
  sets: string[];
  requires: string[];
}

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function entries(value: unknown): string[] {
  const list = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return list
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

/** A chapter's frontmatter `choices` in the earlier format, as the builds read them. */
function legacyChoices(frontmatter: Record<string, unknown> | null): LegacyChoice[] {
  const value = frontmatter?.choices;
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    const text = typeof record.text === 'string' ? record.text.trim() : '';
    const to = typeof record.to === 'string' ? record.to.trim() : '';
    if (text === '' || !KEBAB.test(to)) return [];
    return [{ text, to, sets: entries(record.sets), requires: entries(record.requires) }];
  });
}

function flagOf(entry: string): { name: string; negated: boolean } {
  const match = /^not\s+(.+)$/u.exec(entry);
  return match ? { name: match[1]!.trim(), negated: true } : { name: entry, negated: false };
}

/**
 * Prose as ink lines, its HTML comments (the writer's notes) kept as ink
 * block comments so nothing they wrote is lost.
 */
function proseToInk(prose: string): string[] {
  const lines: string[] = [];
  let position = 0;
  const text = (part: string) => {
    const converted = markdownToInk(part);
    while (converted[0] === '') converted.shift();
    if (converted.length > 0) lines.push(...converted, '');
  };
  for (const range of scanMarkup(prose)) {
    if (range.kind !== 'comment') continue;
    text(prose.slice(position, range.start));
    const note = prose
      .slice(range.start + 4, range.end - 3)
      .replace(/\*\//gu, '* /')
      .trim();
    lines.push(`/* ${note} */`, '');
    position = range.end;
  }
  text(prose.slice(position));
  while (lines.at(-1) === '') lines.pop();
  return lines;
}

const FRONTMATTER = /^\uFEFF?---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/u;

/** The files converting a book writes, with what each held before. */
export function convertToInk(input: ConvertInput): ConvertedFile[] {
  const chapters = orderChapters(input.chapters).map((chapter) => {
    const parsed = parseFrontmatter(chapter.text);
    return { ...chapter, choices: legacyChoices(parsed.frontmatter) };
  });
  const ids = new Set(chapters.map((chapter) => chapter.id));
  const branching = chapters.some((chapter) => chapter.choices.length > 0);
  const flags = new Set<string>();
  const knot = (id: string) => inkKnotName(id);

  const files: ConvertedFile[] = chapters.map((chapter, position) => {
    const head = FRONTMATTER.exec(chapter.text)?.[0] ?? '';
    const body = chapter.text.slice(head.length);
    // The chapter's planning stays Markdown above its `## Chapter Text`.
    const start = proseStart(body);
    const afterHeading = chapterTextEnd(body);
    let planning = body.slice(0, start);
    if (afterHeading === null) {
      planning = `${planning.trimEnd()}${planning.trim() === '' ? '' : '\n\n'}## Chapter Text\n`;
    } else if (!/\n$/u.test(planning)) {
      planning += '\n';
    }
    const prose = proseToInk(body.slice(start).replace(/^\r?\n/u, ''));
    let ending: string[];
    if (!branching) {
      const next = chapters[position + 1];
      ending = [`-> ${next === undefined ? 'END' : knot(next.id)}`];
    } else if (chapter.choices.length === 0) {
      ending = ['-> END'];
    } else {
      ending = chapter.choices.flatMap((choice) => {
        const condition = choice.requires
          .map((entry) => {
            const { name, negated } = flagOf(entry);
            if (!ids.has(name)) flags.add(name);
            const tested = ids.has(name) ? knot(name) : name;
            return negated ? `not ${tested}` : tested;
          })
          .join(' and ');
        const effects = choice.sets.map((entry) => {
          const { name, negated } = flagOf(entry);
          flags.add(name);
          return `${name} = ${negated ? 'false' : 'true'}`;
        });
        const closing: ClosingChoice = {
          text: choice.text,
          once: false,
          condition,
          effects,
          to: knot(choice.to),
        };
        return choiceLines(closing);
      });
    }
    const ink = [...prose, ...(prose.length > 0 ? [''] : []), ...ending].join('\n');
    const frontmatter = head === '' ? '' : removeFrontmatterField(head, 'choices');
    return {
      path: chapter.path,
      before: chapter.text,
      after: `${frontmatter}${planning}\n${ink}\n`,
    };
  });

  const declarations = [...flags].map((flag) => `VAR ${flag} = false`);
  if (input.variables === null) {
    files.push({
      path: INK_VARIABLES_FILE,
      before: null,
      after: [
        '---',
        'title: Story variables',
        '---',
        '// Ink for the whole story: VAR, CONST, and LIST declarations, functions, and shared knots.',
        ...declarations,
        '',
      ].join('\n'),
    });
  } else {
    const missing = declarations.filter(
      (line) => !new RegExp(`^\\s*VAR\\s+${line.split(' ')[1]}\\b`, 'mu').test(input.variables!),
    );
    if (missing.length > 0) {
      files.push({
        path: INK_VARIABLES_FILE,
        before: input.variables,
        after: `${input.variables.trimEnd()}\n${missing.join('\n')}\n`,
      });
    }
  }

  let story = setFrontmatterField(input.story, 'interactive', 'true');
  const ifid = parseFrontmatter(input.story).frontmatter?.ifid;
  if (!isIfid(ifid)) story = setFrontmatterField(story, 'ifid', randomUUID().toUpperCase());
  files.push({ path: 'story.md', before: input.story, after: story });
  return files;
}
