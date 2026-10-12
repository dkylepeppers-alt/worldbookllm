import { inkKnotName, inkSection, inkTag, isIfid, orderChapters } from './format.js';

/** A chapter file of an interactive book. */
export interface InkChapterFile {
  id: string;
  title: string;
  path: string;
  /** The frontmatter `number`, which orders chapters. */
  number: unknown;
  /** The whole file, frontmatter included. */
  text: string;
}

/** A Markdown file under `ink/` whose body is ink. */
interface InkSupportFile {
  path: string;
  text: string;
}

export interface AssembleInput {
  title: string;
  author: string;
  ifid: string | null;
  chapters: readonly InkChapterFile[];
  inkFiles: readonly InkSupportFile[];
}

interface AssembledChapter {
  id: string;
  title: string;
  path: string;
  knot: string;
}

/** A place in a book file. */
interface SourcePlace {
  path: string;
  line: number | null;
}

export interface AssembledStory {
  /** The file the compiler starts from. */
  root: string;
  /** Every file the compiler reads, by the name its INCLUDE uses. */
  files: Record<string, string>;
  /** Chapters in reading order. */
  chapters: AssembledChapter[];
  /** Where the story starts when no `ink/` file diverts first; null with no chapters. */
  defaultStart: string | null;
  /** The book file and line a line of a compiled file comes from; null for the root. */
  locate(file: string, line: number): SourcePlace | null;
  /** The text of a book file's line, as written. */
  lineText(path: string, line: number): string | null;
  /** The whole story as one ink file, as the `.ink` export writes it. */
  combined: string;
}

const ROOT_FILE = 'main.ink';

// ink files whose top-level content diverts before the first knot set the start.
const KNOT_LINE = /^\s*={2,}/u;
const DIVERT_LINE = /^\s*->/u;

/** A file's ink split into what runs at the top (before any knot) and the knots after it. */
function splitTopLevel(body: string): { top: string; knots: string } {
  const lines = body.split('\n');
  const at = lines.findIndex((line) => KNOT_LINE.test(line));
  if (at === -1) return { top: body, knots: '' };
  return { top: lines.slice(0, at).join('\n'), knots: lines.slice(at).join('\n') };
}

function divertsAtTop(body: string): boolean {
  return splitTopLevel(body)
    .top.split('\n')
    .some((line) => DIVERT_LINE.test(line));
}

/**
 * The book as files for inkjs's compiler: a root that carries the story's
 * tags and includes each `ink/` file and chapter, and one file per book
 * file named by its path, so the compiler's messages name the book file. A
 * chapter's knot line and `# chapter:` tag are added before its body.
 */
export function assembleStory(input: AssembleInput): AssembledStory {
  const chapters = orderChapters(input.chapters);
  const inkFiles = [...input.inkFiles].sort((left, right) =>
    left.path.localeCompare(right.path, 'en'),
  );
  const tags = [inkTag('title', input.title)];
  if (input.author.trim() !== '') tags.push(inkTag('author', input.author));
  if (isIfid(input.ifid)) tags.push(inkTag('ifid', input.ifid.toUpperCase()));

  const files: Record<string, string> = {};
  // Where each book file's body starts, and how many lines were added before it.
  const offsets = new Map<string, { firstLine: number; added: number; text: string }>();

  const inkBodies = inkFiles.map((file) => {
    const { ink: body, firstLine } = inkSection(file.text, 'ink');
    files[file.path] = body;
    offsets.set(file.path, { firstLine, added: 0, text: file.text });
    return { path: file.path, body };
  });
  const assembled = chapters.map((chapter) => {
    const knot = inkKnotName(chapter.id);
    const { ink: body, firstLine } = inkSection(chapter.text, 'chapter');
    const head = [`=== ${knot} ===`, inkTag('chapter', chapter.title)];
    files[chapter.path] = `${head.join('\n')}\n${body}`;
    offsets.set(chapter.path, { firstLine, added: head.length, text: chapter.text });
    return { id: chapter.id, title: chapter.title, path: chapter.path, knot, head, body };
  });

  const first = assembled[0]?.knot ?? null;
  const diverted = inkBodies.some((file) => divertsAtTop(file.body));
  // The opening divert comes straight after the tags: an include that prints
  // nothing between the tags and the first line makes ink print an empty
  // line. Declarations are global wherever they are, so the includes can
  // follow it; an `ink/` file that diverts at its top sets the start instead.
  const opening = !diverted && first !== null ? [`-> ${first}`] : [];
  // INCLUDE takes the rest of its line as the file name.
  files[ROOT_FILE] = [
    ...tags,
    ...opening,
    ...inkBodies.map((file) => `INCLUDE ${file.path}`),
    ...assembled.map((chapter) => `INCLUDE ${chapter.path}`),
    '',
  ].join('\n');

  // One file for Inky, in the order the includes run: the top-level parts,
  // then the knots, so no file's top-level lines land inside another's knot.
  const parts = inkBodies.map((file) => ({ path: file.path, ...splitTopLevel(file.body) }));
  const combined = [
    ...tags,
    ...(opening.length > 0 ? [...opening, ''] : ['']),
    ...parts.flatMap((part) =>
      part.top.trim() === '' ? [] : [`// ${part.path}`, part.top.trimEnd(), ''],
    ),
    ...parts.flatMap((part) =>
      part.knots.trim() === '' ? [] : [`// ${part.path}`, part.knots.trimEnd(), ''],
    ),
    ...assembled.flatMap((chapter) => [
      `// ${chapter.path}`,
      ...chapter.head,
      chapter.body.trimEnd(),
      '',
    ]),
  ]
    .join('\n')
    .trimEnd()
    .concat('\n');

  return {
    root: ROOT_FILE,
    files,
    chapters: assembled.map(({ id, title, path, knot }) => ({ id, title, path, knot })),
    defaultStart: diverted ? null : first,
    locate(file, line) {
      const offset = offsets.get(file);
      if (offset === undefined) return null;
      const bodyLine = line - offset.added;
      return { path: file, line: bodyLine < 1 ? null : offset.firstLine + bodyLine - 1 };
    },
    lineText(path, line) {
      const text = offsets.get(path)?.text;
      return text === undefined ? null : (text.split(/\r?\n/u)[line - 1] ?? null);
    },
    combined,
  };
}
