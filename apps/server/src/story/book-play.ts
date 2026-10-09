import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BookBranches, BookPlay } from '@worldbookllm/shared';
import { Compiler, CompilerOptions, Story } from 'inkjs/full';

import { ConflictError, StoryCommandError } from '../errors.js';
import { inkKnotName, inkSource, storyFlags, type InkPassage } from './ink/ink-writer.js';
import type { StoryCli } from './story-cli.js';

/** Same allowance as `story build` and `story export`. */
const PLAY_TIMEOUT_MS = 120_000;

/** A link line as story-skills' tweeSource writes it: `[[text->chapter-id]]`. */
const LINK_LINE = /^\[\[([^[\]]+)->([a-z0-9]+(?:-[a-z0-9]+)*)\]\]$/u;

interface TweePassage {
  id: string;
  prose: string;
  links: { text: string; to: string }[];
}

/**
 * Reads the Twee 3 that `story build --format twee` writes (story-skills
 * 0.23.0 tweeSource): StoryTitle, StoryData, then one passage per chapter
 * named by its id, holding the chapter prose exactly as every build
 * assembles it, and a link line per choice.
 */
function parseTwee(source: string): { passages: TweePassage[] } {
  const sections: { name: string; lines: string[] }[] = [];
  for (const line of source.replace(/\r\n?/gu, '\n').split('\n')) {
    if (line.startsWith(':: ')) sections.push({ name: line.slice(3).trim(), lines: [] });
    // tweeSource escapes a prose line that starts with `::`.
    else sections.at(-1)?.lines.push(line.startsWith('\\::') ? line.slice(1) : line);
  }
  const passages = sections
    .filter((section) => section.name !== 'StoryTitle' && section.name !== 'StoryData')
    .map((section) => {
      const lines = [...section.lines];
      while (lines.length > 0 && lines.at(-1)!.trim() === '') lines.pop();
      const links: TweePassage['links'] = [];
      for (let match = LINK_LINE.exec(lines.at(-1) ?? ''); match;) {
        links.unshift({ text: match[1]!, to: match[2]! });
        lines.pop();
        match = LINK_LINE.exec(lines.at(-1) ?? '');
      }
      while (lines.length > 0 && lines.at(-1)!.trim() === '') lines.pop();
      while (lines.length > 0 && lines[0]!.trim() === '') lines.shift();
      return { id: section.name, prose: lines.join('\n'), links };
    });
  return { passages };
}

/** `# name: value` among the global tags at the top of ink source, unescaped. */
function headerTag(source: string, name: string): string {
  for (const line of source.split('\n')) {
    if (!line.startsWith('#')) break;
    const match = new RegExp(`^# ${name}: (.*)$`, 'u').exec(line);
    if (match) return match[1]!.replace(/\\(.)/gu, '$1');
  }
  return '';
}

/**
 * Compiles ink source with inkjs, counting every visit so the Play screen can
 * tell which chapter's knot each line comes from.
 */
export function compileInk(source: string): { story: string; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const compiler = new Compiler(
    source,
    new CompilerOptions(null, [], true, (message: string, type: number) => {
      // ErrorType: 0 author note, 1 warning, 2 error.
      (type === 2 ? errors : warnings).push(message);
    }),
  );
  let story: Story | null = null;
  try {
    story = compiler.Compile();
  } catch (error) {
    if (errors.length === 0) errors.push(error instanceof Error ? error.message : String(error));
  }
  const json = errors.length === 0 ? story?.ToJson() : undefined;
  if (json === undefined) {
    throw new ConflictError(
      'ink_compile_failed',
      `The ink does not compile:\n${errors.join('\n') || 'the compiler wrote nothing'}`,
    );
  }
  return { story: json, warnings };
}

/** Runs one `story build` into the work folder; a refusal throws as it would for the build. */
async function build(cli: StoryCli, root: string, format: 'twee' | 'ink', out: string) {
  const result = await cli.run({
    command: 'build',
    root,
    out,
    options: { format },
    timeoutMs: PLAY_TIMEOUT_MS,
  });
  // Exit 1 means a warning story.md promotes to an error; the file is still written.
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    const message = result.stderr.trim() || result.stdout.trim();
    throw new StoryCommandError(result.exitCode, message || 'story build failed');
  }
  return `${result.stdout}\n${result.stderr}`
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^(warning|error):/u.test(line));
}

/**
 * The book as worldbookllm's ink (ADR 0028). story-skills builds it twice
 * into an operation-specific temporary folder (never the book's `dist/`):
 * as Twee, for each chapter's prose exactly as every build assembles it and
 * the same refusals, and as ink, for the title, author, and IFID its header
 * carries. The ink writer then writes the story from those, with each
 * choice's state from the branch graph, and inkjs compiles it.
 */
export async function buildPlay(
  cli: StoryCli,
  root: string,
  branches: BookBranches,
): Promise<BookPlay> {
  const workDir = mkdtempSync(join(tmpdir(), 'worldbookllm-play-'));
  try {
    const tweeOut = join(workDir, 'story.twee');
    const inkOut = join(workDir, 'story.ink');
    const [warnings] = await Promise.all([
      build(cli, root, 'twee', tweeOut),
      build(cli, root, 'ink', inkOut),
    ]);
    const header = readFileSync(inkOut, 'utf8');
    const { passages } = parseTwee(readFileSync(tweeOut, 'utf8'));
    const chapters = new Map(branches.chapters.map((chapter) => [chapter.id, chapter]));

    const inkPassages: InkPassage[] = passages.map((passage) => {
      const chapter = chapters.get(passage.id);
      // In a branching book the build's links are the chapter's choices to
      // chapters that exist, in order; their state comes from the graph.
      const choices = (chapter?.choices ?? []).filter((choice) => chapters.has(choice.to));
      const matches =
        choices.length === passage.links.length &&
        choices.every(
          (choice, index) =>
            choice.text === passage.links[index]!.text && choice.to === passage.links[index]!.to,
        );
      return {
        id: passage.id,
        title: chapter?.title ?? passage.id,
        body: passage.prose,
        choices: matches
          ? choices
          : passage.links.map((link) => ({ ...link, sets: [], requires: [] })),
      };
    });

    const story = {
      title: headerTag(header, 'title'),
      author: headerTag(header, 'author'),
      ifid: headerTag(header, 'ifid'),
      branching: branches.branching,
      passages: inkPassages,
    };
    const source = inkSource(story);
    const compiled = compileInk(source);
    return {
      title: story.title,
      ifid: story.ifid,
      source,
      story: compiled.story,
      knots: inkPassages.map((passage) => ({
        knot: inkKnotName(passage.id),
        chapterId: passage.id,
        title: passage.title,
      })),
      flags: story.branching ? storyFlags(story) : [],
      warnings: [
        // The Branches screen offers to pin the IFID; a play-through need not repeat it.
        ...warnings.filter((line) => !line.endsWith('[derived-ifid]')),
        ...compiled.warnings.map((warning) => `ink: ${warning}`),
      ],
    };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
