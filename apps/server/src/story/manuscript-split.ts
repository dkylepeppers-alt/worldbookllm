import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseFrontmatter } from './book-index.js';
import type { StoryCli } from './story-cli.js';

/** One chapter `story import` found, with its prose as plain Markdown. */
interface SplitChapter {
  title: string;
  /** The chapter's prose, from under its `## Chapter Text` heading. */
  markdown: string;
  /** False for a prologue, epilogue, or unnumbered chapter. */
  numbered: boolean;
  /** The by-line `story import --bylines` read, or a story-skills chapter's own `author`. */
  author: string | string[] | null;
  /** The document the chapter came from. */
  source: string;
}

export interface ManuscriptSplit {
  chapters: SplitChapter[];
  /** Recurring capitalised names `story import` suggests as characters and places. */
  candidates: Array<{ name: string; count: number }>;
}

/** A document to split: its file name (`.md`, `.markdown`, or `.txt`) and text. */
export interface ManuscriptDocument {
  name: string;
  text: string;
}

/**
 * File names for a folder of chapters that `story import` reads in natural
 * order. Each file keeps its own name when every name is distinct, so
 * `story import` can still put a prologue first. Otherwise each name gets
 * its position (the documents are already in natural order) as a
 * zero-padded prefix, which keeps that order and can never collide.
 */
function flatChapterNames(paths: readonly string[]): string[] {
  const names = paths.map((path) => path.slice(path.lastIndexOf('/') + 1));
  if (new Set(names.map((name) => name.toLowerCase())).size === names.length) return names;
  const width = String(paths.length).length;
  return names.map((name, index) => `${String(index + 1).padStart(width, '0')}-${name}`);
}

/** Lines that start a chapter in one of the languages `story import` splits. */
const CHAPTER_LINE =
  /^(?:#{1,6}[ \t]+)?(?:chapter|prologue|epilogue|interlude|afterword|cap[ií]tulo|pr[oó]logo|ep[ií]logo|chapitre|kapitel|prolog|epilog)\b/gimu;

/** Whether a document has at least two chapter headings, so splitting it could help. */
export function looksLikeSeveralChapters(text: string): boolean {
  return (text.match(CHAPTER_LINE)?.length ?? 0) >= 2;
}

function chapterText(body: string): string {
  const match = /^## Chapter Text[ \t]*\n([\s\S]*)$/mu.exec(body);
  return (match?.[1] ?? body).trim();
}

function authorOf(value: unknown): string | string[] | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (Array.isArray(value)) {
    const names = value.filter((name): name is string => typeof name === 'string');
    return names.length > 0 ? names : null;
  }
  return null;
}

/** Documents split at once; each split is a separate `story import` process. */
const SPLIT_CONCURRENCY = 4;

function candidatesOf(data: unknown): ManuscriptSplit['candidates'] {
  const list = (data as { candidates?: unknown } | null)?.candidates;
  if (!Array.isArray(list)) return [];
  return list.flatMap((candidate: unknown) => {
    const { name, count } = (candidate ?? {}) as { name?: unknown; count?: unknown };
    return typeof name === 'string' && typeof count === 'number' ? [{ name, count }] : [];
  });
}

/**
 * Runs `story import` on documents in a fresh temporary folder, removed
 * afterwards whatever happens, and reads back the chapters it wrote. With
 * `dryRun`, nothing is written and only the name candidates come back.
 */
async function importDocuments(
  cli: StoryCli,
  documents: readonly ManuscriptDocument[],
  options: { title: string; language?: string },
  dryRun: boolean,
): Promise<ManuscriptSplit> {
  const workDir = mkdtempSync(join(tmpdir(), 'worldbookllm-split-'));
  try {
    const sourceDir = join(workDir, 'source');
    mkdirSync(sourceDir, { mode: 0o700 });
    const names = flatChapterNames(documents.map((document) => document.name));
    documents.forEach((document, index) => {
      writeFileSync(join(sourceDir, names[index]!), document.text, { mode: 0o600 });
    });
    const result = await cli.runOrThrow({
      command: 'import',
      cwd: workDir,
      dir: 'book',
      args: [sourceDir],
      options: {
        title: options.title,
        ...(options.language ? { language: options.language } : {}),
        ...(dryRun ? { 'dry-run': true } : {}),
      },
      json: true,
    });
    const candidates = candidatesOf(result.envelope?.data);
    if (dryRun) return { chapters: [], candidates };

    const chaptersDir = join(workDir, 'book', 'chapters');
    const files = readdirSync(chaptersDir)
      .filter((name) => /^chapter-\d+\.md$/u.test(name))
      .sort((left, right) => Number(/\d+/u.exec(left)![0]) - Number(/\d+/u.exec(right)![0]));
    const chapters = files.map((name): SplitChapter => {
      const { frontmatter, body } = parseFrontmatter(readFileSync(join(chaptersDir, name), 'utf8'));
      return {
        title: typeof frontmatter?.title === 'string' ? frontmatter.title : name,
        markdown: chapterText(body),
        numbered: frontmatter?.numbered !== false,
        author: authorOf(frontmatter?.author),
        source: documents[0]?.name ?? '',
      };
    });
    return { chapters, candidates };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

/**
 * Splits manuscript documents into chapters the way `story import` does.
 * Each document is split on its own, so every chapter knows the document it
 * came from; one dry run over all of them finds the recurring names.
 * Nothing is written into the library: the caller shows the chapters for
 * review and writes the ones the writer keeps.
 */
export async function splitManuscript(
  cli: StoryCli,
  documents: readonly ManuscriptDocument[],
  options: { title: string; language?: string },
): Promise<ManuscriptSplit> {
  if (documents.length === 0) return { chapters: [], candidates: [] };
  if (documents.length === 1) return importDocuments(cli, documents, options, false);

  const splits: SplitChapter[][] = new Array(documents.length);
  let next = 0;
  const worker = async () => {
    while (next < documents.length) {
      const index = next;
      next += 1;
      const split = await importDocuments(cli, [documents[index]!], options, false);
      splits[index] = split.chapters;
    }
  };
  const [{ candidates }] = await Promise.all([
    importDocuments(cli, documents, options, true),
    ...Array.from({ length: Math.min(SPLIT_CONCURRENCY, documents.length) }, worker),
  ]);
  return { chapters: splits.flat(), candidates };
}
