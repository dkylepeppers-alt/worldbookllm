import type { BookImportKind, SourceOrigin, SourcePreview } from '@worldbookllm/shared';

import { parseFrontmatter } from './book-index.js';

/** Where `story add` puts each importable kind (story-skills schema v2). */
export const IMPORT_KIND_DIRECTORIES: Readonly<Record<BookImportKind, string>> = {
  research: 'research',
  character: 'characters',
  location: 'worldbuilding/locations',
  system: 'worldbuilding/systems',
  faction: 'worldbuilding/factions',
  artifact: 'worldbuilding/artifacts',
  arc: 'plot/arcs',
  question: 'continuity/questions',
  promise: 'continuity/promises',
  clue: 'continuity/clues',
  term: 'glossary/terms',
  matter: 'matter',
  chapter: 'chapters',
};

export interface SplitMarkdown {
  /** The frontmatter block's inner lines, without the `---` fences; null when there is none. */
  frontmatterText: string | null;
  body: string;
}

/** Splits a leading `---` frontmatter block from a Markdown document without reserializing it. */
export function splitFrontmatter(markdown: string): SplitMarkdown {
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/u.exec(markdown);
  if (!match) return { frontmatterText: null, body: markdown };
  return { frontmatterText: match[1] ?? '', body: markdown.slice(match[0].length) };
}

type Frontmatter = Record<string, unknown>;

function has(frontmatter: Frontmatter, ...keys: string[]): boolean {
  return keys.every((key) => frontmatter[key] !== undefined && frontmatter[key] !== null);
}

function hasAny(frontmatter: Frontmatter, ...keys: string[]): boolean {
  return keys.some((key) => frontmatter[key] !== undefined && frontmatter[key] !== null);
}

/**
 * story-skills frontmatter is flat: scalars and lists of scalars. A nested
 * map (or a list of maps) fails `story validate`, so such a file cannot be
 * kept as an entity file.
 */
function isFlat(frontmatter: Frontmatter): boolean {
  return Object.values(frontmatter).every((value) => {
    if (value === null || typeof value !== 'object' || value instanceof Date) return true;
    return Array.isArray(value) && value.every((item) => item === null || typeof item !== 'object');
  });
}

/**
 * The entity kind a story-skills entity file is, judged by the required
 * fields of each kind in the pinned schema and, where required fields
 * overlap, by fields only one kind uses. Null when the frontmatter is not a
 * recognizable entity.
 */
export function entityKindOf(frontmatter: Frontmatter): BookImportKind | null {
  if (!isFlat(frontmatter)) return null;
  if (has(frontmatter, 'term', 'category')) return 'term';
  if (has(frontmatter, 'title', 'placement')) return 'matter';
  if (has(frontmatter, 'title', 'status')) {
    if (hasAny(frontmatter, 'significance-delayed', 'red-herring')) return 'clue';
    if (hasAny(frontmatter, 'planted', 'payoff')) return 'promise';
    if (hasAny(frontmatter, 'introduced', 'resolved')) return 'question';
    if (hasAny(frontmatter, 'sources', 'used-in', 'accuracy', 'confidence', 'method')) {
      return 'research';
    }
  }
  if (has(frontmatter, 'name', 'role', 'status')) return 'character';
  if (has(frontmatter, 'name', 'type')) {
    if (hasAny(frontmatter, 'members')) return 'faction';
    if (hasAny(frontmatter, 'owner')) return 'artifact';
    if (hasAny(frontmatter, 'acts', 'mice-threads', 'themes')) return 'arc';
    if (hasAny(frontmatter, 'prevalence')) return 'system';
    if (
      hasAny(frontmatter, 'region', 'population', 'controlled-by', 'notable-characters', 'routes')
    ) {
      return 'location';
    }
  }
  return null;
}

/** A chapter heading or file name: `Chapter 3`, `CHAPTER ONE: Arrival`, `ch-02`, `Prologue`. */
const CHAPTER_NAME =
  /^(?:chapter|ch|kapitel|chapitre|cap[ií]tulo)\b|^ch[-_ ]?\d|^(?:prologue|epilogue|interlude|afterword)\b/iu;

/** Folders whose files are notes about the book rather than its prose. */
const NOTE_FOLDER =
  /^(?:research|notes?|sources?|references?|bible|lore|world|worldbuilding|characters?|locations?|outlines?|plot|planning)$/iu;

function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** A file in story-skills' own chapter layout: frontmatter and a `## Chapter Text` section. */
function isStoryChapterFile(markdown: string): boolean {
  return /^---\n/u.test(markdown) && /^## Chapter Text[ \t]*$/mu.test(markdown);
}

/**
 * The kind to suggest for a converted entry, and whether it is already an
 * entity file. Story-skills entity frontmatter decides first. Otherwise a
 * chapter-like title, file name, or story-skills chapter file suggests a
 * chapter, unless the file sits in a notes folder (`research/`, `notes/`).
 */
export function suggestImportKind(
  markdown: string,
  format: SourcePreview['format'],
  hint: { title?: string; path?: string } = {},
): { suggestedKind: BookImportKind; entityFile: boolean } {
  const { frontmatter } = parseFrontmatter(markdown);
  const kind = frontmatter ? entityKindOf(frontmatter) : null;
  if (kind) return { suggestedKind: kind, entityFile: true };
  if (format === 'character') return { suggestedKind: 'character', entityFile: false };
  const folders = hint.path?.split('/').slice(0, -1) ?? [];
  if (folders.some((folder) => NOTE_FOLDER.test(folder))) {
    return { suggestedKind: 'research', entityFile: false };
  }
  const chapterLike =
    isStoryChapterFile(markdown) ||
    CHAPTER_NAME.test(hint.title?.trim() ?? '') ||
    CHAPTER_NAME.test(fileName(hint.path ?? '')) ||
    folders.some((folder) => /^(?:chapters?|manuscript|drafts?)$/iu.test(folder));
  return { suggestedKind: chapterLike ? 'chapter' : 'research', entityFile: false };
}

/**
 * How a file from a zip with no `story.md` is filed when it becomes a new
 * book: entity files and files in notes folders keep their suggested kind,
 * and everything else is the manuscript, one chapter per file.
 */
export function archiveDocumentKind(path: string, markdown: string): BookImportKind {
  const { suggestedKind, entityFile } = suggestImportKind(markdown, 'markdown', { path });
  const inNotes = path
    .split('/')
    .slice(0, -1)
    .some((folder) => NOTE_FOLDER.test(folder));
  return entityFile || inNotes ? suggestedKind : 'chapter';
}

/**
 * The title to give `story add chapter`, which numbers the chapter itself:
 * `Chapter 3: The Harbor` becomes `The Harbor`. A bare `Chapter 3` keeps its
 * text, since a chapter needs some title.
 */
export function chapterTitle(title: string): string {
  const stripped = title
    .replace(/^(?:chapter|ch\.?)\s+[\p{L}\p{N}.-]+\s*(?:[:.\-–—]\s*)?/iu, '')
    .trim();
  return stripped === '' ? title.trim() : stripped;
}

/** A title `story import` gives a chapter that had none: `Chapter 3`. */
function isUntitledChapter(title: string): boolean {
  return /^chapter\s+[\p{L}\p{N}.]+$/iu.test(title.trim());
}

/** How a chapter is headed and credited, as `story import` would write it. */
export interface ChapterShape {
  /** False for a prologue, epilogue, or other unnumbered chapter. */
  numbered?: boolean;
  /** A collection's or anthology's writer of this chapter. */
  author?: string | string[] | null;
}

/** The imported prose: a story-skills chapter's own text, or the body less a repeated heading. */
function importedProse(markdown: string, title: string): { prose: string; stray: string | null } {
  const imported = splitFrontmatter(markdown);
  const chapterText = /^## Chapter Text[ \t]*\n([\s\S]*)$/mu.exec(imported.body);
  if (chapterText) return { prose: (chapterText[1] ?? '').trim(), stray: null };
  return {
    prose: withoutChapterHeading(imported.body, title).trimEnd(),
    stray: imported.frontmatterText,
  };
}

function strayFrontmatterSection(stray: string | null): string[] {
  return stray === null ? [] : [`## Imported Frontmatter\n\n\`\`\`yaml\n${stray}\n\`\`\``];
}

function authorLines(author: string | string[] | null | undefined): string[] {
  if (author === null || author === undefined) return [];
  if (typeof author === 'string') return [`author: ${quoted(author)}`];
  return ['author:', ...author.map((name) => `  - ${quoted(name)}`)];
}

/**
 * A chapter `story add chapter` created, given the imported prose under
 * `## Chapter Text` (the section builds and exports read) and marked as a
 * draft. It is headed as `story import` heads one: an untitled chapter is
 * `# Chapter N`, and an unnumbered one (a prologue) gets `numbered: false`
 * and its title alone. A story-skills chapter file brings only its own
 * chapter text; other frontmatter is kept visibly in a
 * `## Imported Frontmatter` section outside the prose, so no imported text
 * disappears and none leaks into the book.
 */
export function fillCreatedChapter(
  created: string,
  markdown: string,
  title: string,
  provenance: readonly string[],
  shape: ChapterShape = {},
): string {
  const { frontmatterText, body: template } = splitFrontmatter(created);
  const number = /^number:\s*(\d+)\s*$/mu.exec(frontmatterText ?? '')?.[1];
  const untitled = isUntitledChapter(title) && number !== undefined;
  let heading = /^\s*(# .+)\n/u.exec(template)?.[1] ?? `# ${title}`;
  let fields = (frontmatterText ?? '').replace(/^status:.*$/mu, 'status: draft');
  if (shape.numbered === false) {
    heading = `# ${title}`;
    fields = fields.replace(/^(title:.*)$/mu, '$1\nnumbered: false');
  } else if (untitled) {
    heading = `# Chapter ${number}`;
    fields = fields.replace(/^title:.*$/mu, `title: ${quoted(`Chapter ${number}`)}`);
  }
  const lines = mergeProvenance(fields, [...authorLines(shape.author), ...provenance]);
  const { prose, stray } = importedProse(markdown, title);
  const parts = [heading, ...strayFrontmatterSection(stray), '## Chapter Text', prose];
  return `---\n${lines.join('\n')}\n---\n\n${parts.join('\n\n').trimEnd()}\n`;
}

/**
 * An existing chapter with its prose replaced by an imported revision. Its
 * frontmatter (POV, cast, scenes, status) and everything above
 * `## Chapter Text`, such as an outline, stay as they were.
 */
export function replaceChapterText(
  existing: string,
  markdown: string,
  title: string,
  provenance: readonly string[],
): string {
  const { frontmatterText, body } = splitFrontmatter(existing);
  const lines = mergeProvenance(frontmatterText ?? '', provenance);
  const { prose, stray } = importedProse(markdown, title);
  const marker = /^## Chapter Text[ \t]*$/mu.exec(body);
  const before = (marker ? body.slice(0, marker.index) : `${body.trimEnd()}\n\n`).trimEnd();
  const parts = [before, ...strayFrontmatterSection(stray), '## Chapter Text', prose].filter(
    (part) => part !== '',
  );
  return `---\n${lines.join('\n')}\n---\n\n${parts.join('\n\n').trimEnd()}\n`;
}

/** Drops a leading heading that names the chapter, since the chapter file has its own. */
function withoutChapterHeading(body: string, title: string): string {
  const trimmed = body.replace(/^\s+/u, '');
  const match = /^#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*(?:\n|$)/u.exec(trimmed);
  const heading = match?.[1]?.trim();
  if (
    match &&
    heading !== undefined &&
    (CHAPTER_NAME.test(heading) || chapterTitle(heading).toLowerCase() === title.toLowerCase())
  ) {
    return trimmed.slice(match[0].length).replace(/^\s+/u, '');
  }
  return withoutRepeatedTitle(trimmed, title);
}

/** A YAML double-quoted scalar the story CLI's parser reads back exactly. */
export function quoted(value: string): string {
  return JSON.stringify(value);
}

/**
 * Flat provenance keys added to an imported file's frontmatter (ADR 0014
 * decision 4): story-skills allows extra flat keys, and these keep the
 * origin visible in the file itself.
 */
export function provenanceLines(
  origin: SourceOrigin,
  conversionNotes: readonly string[],
  importedAt: string,
): string[] {
  const lines = [`origin-type: ${quoted(origin.type)}`];
  switch (origin.type) {
    case 'file':
      lines.push(`origin-file: ${quoted(origin.fileName)}`);
      lines.push(`origin-media-type: ${quoted(origin.mediaType)}`);
      break;
    case 'url':
      lines.push(`origin-url: ${quoted(origin.url)}`);
      lines.push(`origin-fetched-at: ${quoted(origin.fetchedAt)}`);
      lines.push(`origin-media-type: ${quoted(origin.mediaType)}`);
      break;
    case 'assistant-response':
      lines.push(`origin-chat-id: ${quoted(origin.chatId)}`);
      lines.push(`origin-message-id: ${quoted(origin.messageId)}`);
      break;
    case 'paste':
      break;
  }
  lines.push(`imported-at: ${quoted(importedAt)}`);
  if (conversionNotes.length > 0) {
    lines.push('conversion-notes:');
    for (const note of conversionNotes) lines.push(`  - ${quoted(note)}`);
  }
  return lines;
}

/** Drops a leading `# Title` heading that just repeats the entry title. */
function withoutRepeatedTitle(body: string, title: string): string {
  const trimmed = body.replace(/^\s+/u, '');
  const match = /^#[ \t]+(.+?)[ \t]*#*[ \t]*(?:\n|$)/u.exec(trimmed);
  if (match && match[1]?.trim().toLowerCase() === title.trim().toLowerCase()) {
    return trimmed.slice(match[0].length).replace(/^\s+/u, '');
  }
  return trimmed;
}

/**
 * The body an import gets. Frontmatter that cannot stay live (it is not an
 * entity of the chosen kind) is kept visibly as a fenced block rather than
 * dropped, so no imported text disappears.
 */
export function importedBody(markdown: string, title: string, keepFrontmatter: boolean): string {
  const { frontmatterText, body } = splitFrontmatter(markdown);
  const content = withoutRepeatedTitle(body, title).trimEnd();
  const parts: string[] = [];
  if (content !== '') parts.push(content);
  if (frontmatterText !== null && !keepFrontmatter) {
    parts.push(`## Original frontmatter\n\n\`\`\`yaml\n${frontmatterText}\n\`\`\``);
  }
  return parts.join('\n\n');
}

/**
 * A research note in the exact shape `story add research` writes, with
 * provenance appended and the imported content under `## Findings`.
 */
export function renderResearchNote(
  title: string,
  body: string,
  provenance: readonly string[],
): string {
  return [
    '---',
    `title: ${quoted(title)}`,
    'status: open',
    'sources: []',
    'used-in: []',
    ...provenance,
    '---',
    '',
    `# ${title}`,
    '',
    '## Findings',
    '',
    body === '' ? 'The imported source had no text.' : body,
    '',
  ].join('\n');
}

/** Top-level keys already present in a frontmatter block. */
function frontmatterKeys(frontmatterText: string): Set<string> {
  const keys = new Set<string>();
  for (const line of frontmatterText.split('\n')) {
    const match = /^([A-Za-z0-9_-]+):/u.exec(line);
    if (match?.[1]) keys.add(match[1]);
  }
  return keys;
}

function keyOf(line: string): string | null {
  return /^([A-Za-z0-9_-]+):/u.exec(line)?.[1] ?? null;
}

/**
 * Appends provenance to a frontmatter block, skipping any key the block
 * already defines (a repeated key would make the file unreadable), along
 * with that key's list items.
 */
function mergeProvenance(frontmatterText: string, provenance: readonly string[]): string[] {
  const existing = frontmatterKeys(frontmatterText);
  const merged: string[] = frontmatterText === '' ? [] : [frontmatterText];
  let skipping = false;
  for (const line of provenance) {
    const key = keyOf(line);
    if (key !== null) skipping = existing.has(key);
    if (!skipping) merged.push(line);
  }
  return merged;
}

/** An entity file kept as imported, with provenance appended to its own frontmatter. */
export function renderEntityFile(markdown: string, provenance: readonly string[]): string {
  const { frontmatterText, body } = splitFrontmatter(markdown);
  const lines = mergeProvenance(frontmatterText ?? '', provenance);
  return `---\n${lines.join('\n')}\n---\n${body.startsWith('\n') ? '' : '\n'}${body}`;
}

/** The title an entity file names itself by, for its id. */
export function entityFileTitle(markdown: string): string | null {
  const { frontmatter } = parseFrontmatter(markdown);
  for (const key of ['name', 'title', 'term']) {
    const value = frontmatter?.[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return null;
}

/** A file `story add` created, with provenance added and its template body replaced. */
export function fillCreatedEntity(
  created: string,
  body: string,
  provenance: readonly string[],
): string {
  const { frontmatterText, body: template } = splitFrontmatter(created);
  const heading = /^\s*(# .+)\n/u.exec(template)?.[1];
  const lines = mergeProvenance(frontmatterText ?? '', provenance);
  const content =
    body === '' ? template.replace(/^\n+/u, '') : `${heading ? `${heading}\n\n` : ''}${body}\n`;
  return `---\n${lines.join('\n')}\n---\n\n${content}`;
}

/** Kebab-case id from a title, as story-skills derives ids; '' when nothing is left. */
export function kebabId(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replace(/'/gu, '')
    .replace(/[^a-z0-9]+/gu, '-')
    .slice(0, 80)
    .replace(/^-+|-+$/gu, '');
}
