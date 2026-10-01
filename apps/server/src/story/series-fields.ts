import { isDeepStrictEqual } from 'node:util';
import matter from 'gray-matter';

import { parseFrontmatter } from './book-index.js';

/** ADR 0018's canon boundary, pinned to the schema/templates shipped by story-skills. */
export const SERIES_FIELDS_VERSION = '0.18.0';

interface SeriesFieldMap {
  identity: readonly string[];
  local: readonly string[];
  /** null means the entire body is canon. Unknown frontmatter is always local. */
  sections: readonly string[] | null;
}

export const SERIES_FIELDS = {
  character: {
    identity: ['name', 'aliases', 'pronunciation', 'voice-words', 'voice-avoid', 'tags'],
    local: [
      'role',
      'status',
      'died-in',
      'revived-in',
      'relationships',
      'locations',
      'progressions',
      'arc',
      'arc-type',
      'lie',
      'truth',
      'ghost-wound',
    ],
    sections: [
      'Appearance',
      'Personality & Traits',
      'Backstory',
      'Voice & Speech Patterns',
      'Series Canon',
    ],
  },
  location: {
    identity: ['name', 'pronunciation', 'type', 'region', 'setting', 'tags'],
    local: [
      'status',
      'population',
      'controlled-by',
      'notable-characters',
      'routes',
      'progressions',
    ],
    sections: ['Description', 'History', 'Culture & Customs', 'Notable Features', 'Series Canon'],
  },
  system: {
    identity: ['name', 'pronunciation', 'type', 'prevalence'],
    local: [],
    sections: null,
  },
  faction: {
    identity: ['name', 'pronunciation', 'type', 'tags'],
    local: ['status', 'members', 'locations', 'progressions'],
    sections: ['Purpose', 'Power Base', 'Series Canon'],
  },
  artifact: {
    identity: ['name', 'pronunciation', 'type', 'tags'],
    local: ['status', 'owner', 'location'],
    sections: ['Description', 'Function', 'History', 'Series Canon'],
  },
  term: {
    identity: ['term', 'category', 'aliases', 'pronunciation'],
    local: [],
    sections: null,
  },
} as const satisfies Record<string, SeriesFieldMap>;

export type SeriesEntityKind = keyof typeof SERIES_FIELDS;

export function isSeriesEntityKind(kind: string): kind is SeriesEntityKind {
  return Object.hasOwn(SERIES_FIELDS, kind);
}

/** H2 sections include subheadings, but headings inside fenced examples are not boundaries. */
function bodySections(body: string): Map<string, string> {
  const sections = new Map<string, string>();
  let title: string | undefined;
  let lines: string[] = [];
  let fence: { marker: string; length: number } | undefined;
  const save = () => {
    if (title !== undefined) {
      const content = lines.join('\n').trim();
      sections.set(title, sections.has(title) ? `${sections.get(title)}\n${content}` : content);
    }
  };
  for (const line of body.split(/\r?\n/u)) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (marker !== null) {
      const run = marker[1]!;
      if (fence === undefined) fence = { marker: run[0]!, length: run.length };
      else if (run[0] === fence.marker && run.length >= fence.length && marker[2]!.trim() === '') {
        fence = undefined;
      }
      lines.push(line);
      continue;
    }
    const heading =
      fence === undefined ? /^ {0,3}##[\t ]+(.+?)(?:[\t ]+#+)?[\t ]*$/u.exec(line) : null;
    if (heading !== null) {
      save();
      title = heading[1]!.trim();
      lines = [];
    } else {
      lines.push(line);
    }
  }
  save();
  return sections;
}

/** Unknown fields and book-local sections never participate in canon drift. */
export function identityDifferences(
  kind: SeriesEntityKind,
  bibleContent: string,
  bookContent: string,
): string[] {
  const bible = parseFrontmatter(bibleContent);
  const book = parseFrontmatter(bookContent);
  const map: SeriesFieldMap = SERIES_FIELDS[kind];
  const fields: string[] = map.identity.filter(
    (field) => !isDeepStrictEqual(bible.frontmatter?.[field], book.frontmatter?.[field]),
  );
  if (map.sections === null) {
    if (bible.body.trim() !== book.body.trim()) fields.push('body');
  } else {
    const canon = bodySections(bible.body);
    const local = bodySections(book.body);
    for (const section of map.sections) {
      if (canon.get(section) !== local.get(section)) fields.push(`body:${section}`);
    }
  }
  return fields;
}

/** Replaces only named canon sections, preserving every other target section verbatim. */
function mergeBody(kind: SeriesEntityKind, source: string, target: string): string {
  const sections: readonly string[] | null = SERIES_FIELDS[kind].sections;
  if (sections === null) return source;
  const sourceSections = bodySections(source);
  // Section boundaries use the same fence-aware parser as comparison. Mark a boundary
  // with a sentinel so local prose (including duplicate headings) is retained as written.
  const canon = new Set(sections);
  let fence: { marker: string; length: number } | undefined;
  const blocks: Array<{ title: string | null; lines: string[] }> = [{ title: null, lines: [] }];
  for (const line of target.split(/\r?\n/u)) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (marker !== null) {
      const run = marker[1]!;
      if (fence === undefined) fence = { marker: run[0]!, length: run.length };
      else if (run[0] === fence.marker && run.length >= fence.length && marker[2]!.trim() === '')
        fence = undefined;
      blocks.at(-1)!.lines.push(line);
      continue;
    }
    const heading =
      fence === undefined ? /^ {0,3}##[\t ]+(.+?)(?:[\t ]+#+)?[\t ]*$/u.exec(line) : null;
    if (heading !== null) blocks.push({ title: heading[1]!.trim(), lines: [line] });
    else blocks.at(-1)!.lines.push(line);
  }
  const seen = new Set<string>();
  const output = blocks.flatMap((block) => {
    if (block.title === null || !canon.has(block.title)) return [block.lines.join('\n')];
    if (seen.has(block.title)) return [];
    seen.add(block.title);
    const content = sourceSections.get(block.title);
    return content === undefined ? [] : [`## ${block.title}\n${content}\n`];
  });
  for (const section of sections) {
    const content = sourceSections.get(section);
    if (!seen.has(section) && content !== undefined) output.push(`\n## ${section}\n${content}\n`);
  }
  return output.join('\n');
}

export function mergeIdentity(kind: SeriesEntityKind, source: string, target: string): string {
  // Unlike read-only drift, writes must refuse malformed YAML rather than replace it.
  const canon = matter(source);
  const local = matter(target);
  const data: Record<string, unknown> = { ...local.data };
  for (const field of SERIES_FIELDS[kind].identity) {
    if (Object.hasOwn(canon.data, field)) data[field] = canon.data[field];
    else delete data[field];
  }
  return matter.stringify(mergeBody(kind, canon.content, local.content), data);
}

/** New copies have fresh safe local defaults, never source-book references or state. */
export function carryIdentity(kind: SeriesEntityKind, source: string, id: string): string {
  const canon = matter(source);
  // Entity ids are filenames in story-skills; frontmatter never carries one.
  const defaults: Record<string, unknown> = {};
  if (kind === 'character') Object.assign(defaults, { role: 'supporting', status: 'alive' });
  if (kind === 'faction' || kind === 'artifact') defaults.status = 'active';
  const title = String(canon.data.name ?? canon.data.term ?? id);
  return mergeIdentity(kind, source, matter.stringify(`# ${title}\n\n`, defaults));
}
