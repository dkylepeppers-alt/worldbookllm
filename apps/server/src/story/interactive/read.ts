import { parseFrontmatter } from '../book-index.js';
import { classifyBookPath } from '../book-paths.js';
import { assembleStory, type AssembledStory } from './assemble.js';
import { compileStory, type CompiledStory } from './compile.js';
import { isInkFile } from './format.js';
import { storyStructure, type StoryStructure } from './structure.js';

/** A book file as the ink pipeline reads it. */
export interface BookTextFile {
  path: string;
  /** Its title, as the book index has it. */
  title: string;
  text: string;
}

/** A book's ink, assembled, compiled, and read (ADR 0030). */
export interface InkReading {
  assembled: AssembledStory;
  compiled: CompiledStory;
  /** The story's structure, or null when it does not compile. */
  structure: StoryStructure | null;
}

function field(frontmatter: Record<string, unknown> | null, key: string): string | null {
  const value = frontmatter?.[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * Reads a book's ink from its files: story.md for the title, author, and
 * IFID, every chapter, and every `ink/` file. The same reading serves the
 * book as it is, a file's unsaved text, and the agent's staged copy.
 */
export function readInkStory(files: readonly BookTextFile[], fallbackTitle: string): InkReading {
  const story = parseFrontmatter(files.find((file) => file.path === 'story.md')?.text ?? '');
  const assembled = assembleStory({
    title: field(story.frontmatter, 'title') ?? fallbackTitle,
    author: field(story.frontmatter, 'author') ?? '',
    ifid: field(story.frontmatter, 'ifid'),
    chapters: files.flatMap((file) => {
      const { kind, entityId } = classifyBookPath(file.path);
      if (kind !== 'chapter' || entityId === null) return [];
      return [
        {
          id: entityId,
          title: file.title,
          path: file.path,
          number: parseFrontmatter(file.text).frontmatter?.number,
          text: file.text,
        },
      ];
    }),
    inkFiles: files.filter((file) => isInkFile(file.path)),
  });
  const compiled = compileStory(assembled);
  const structure =
    compiled.parsed === null || compiled.json === null
      ? null
      : storyStructure(compiled.parsed, assembled);
  return { assembled, compiled, structure };
}

/** Whether a book file is read as ink: a chapter, an `ink/` file, or story.md. */
export function feedsInk(path: string): boolean {
  return path === 'story.md' || isInkFile(path) || classifyBookPath(path).kind === 'chapter';
}
