import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BookPlay } from '@worldbookllm/shared';
import { Compiler, CompilerOptions, Story } from 'inkjs/full';

import { ConflictError, StoryCommandError } from '../errors.js';
import type { StoryCli } from './story-cli.js';

/** Same allowance as `story build` and `story export`. */
const PLAY_TIMEOUT_MS = 120_000;

const INK_RESERVED = new Set(['true', 'false', 'not', 'else', 'return', 'temp', 'function']);

/**
 * A chapter id's knot in the ink build, as story-skills 0.23.0 names it
 * (`inkKnotName` in its ink.js): `-` becomes `_`, and a name that starts with
 * a digit or is reserved in ink takes a leading `_`.
 */
export function inkKnotName(id: string): string {
  const name = id.replace(/-/gu, '_');
  return /^[0-9]/u.test(name) || INK_RESERVED.has(name) ? `_${name}` : name;
}

/** `# name: value` among a story's global tags. */
function globalTag(tags: readonly string[] | null, name: string): string {
  const prefix = `${name}:`;
  return (
    tags
      ?.find((tag) => tag.startsWith(prefix))
      ?.slice(prefix.length)
      .trim() ?? ''
  );
}

/**
 * Compiles ink source with inkjs, counting every visit so the Play screen can
 * tell which chapter's knot each line comes from. An error here means the
 * build wrote ink that inkle's compiler rejects.
 */
export function compileInk(source: string): { story: string; tags: string[]; warnings: string[] } {
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
  if (story === null || errors.length > 0) {
    throw new ConflictError(
      'ink_compile_failed',
      `The ink build does not compile:\n${errors.join('\n')}`,
    );
  }
  const json = story.ToJson();
  if (json === undefined) throw new ConflictError('ink_compile_failed', 'The ink build is empty');
  return { story: json, tags: new Story(json).globalTags ?? [], warnings };
}

/**
 * The book as a playable ink story: built by `story build --format ink` into
 * an operation-specific temporary folder (never the book's `dist/`), so it is
 * exactly the ink a real build writes, then compiled with inkjs.
 */
export async function buildPlay(
  cli: StoryCli,
  root: string,
  chapters: readonly { id: string; title: string }[],
): Promise<BookPlay> {
  const workDir = mkdtempSync(join(tmpdir(), 'worldbookllm-play-'));
  try {
    const out = join(workDir, 'story.ink');
    const result = await cli.run({
      command: 'build',
      root,
      out,
      options: { format: 'ink' },
      timeoutMs: PLAY_TIMEOUT_MS,
    });
    // Exit 1 means a warning story.md promotes to an error; the file is still written.
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      const message = result.stderr.trim() || result.stdout.trim();
      throw new StoryCommandError(result.exitCode, message || 'story build failed');
    }
    const source = readFileSync(out, 'utf8');
    const compiled = compileInk(source);
    const warnings = `${result.stdout}\n${result.stderr}`
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^(warning|error):/u.test(line))
      // The Branches screen offers to pin the IFID; a play-through need not repeat it.
      .filter((line) => !line.endsWith('[derived-ifid]'));
    return {
      title: globalTag(compiled.tags, 'title'),
      ifid: globalTag(compiled.tags, 'ifid'),
      source,
      story: compiled.story,
      knots: chapters.map((chapter) => ({
        knot: inkKnotName(chapter.id),
        chapterId: chapter.id,
        title: chapter.title,
      })),
      warnings: [...warnings, ...compiled.warnings.map((warning) => `ink: ${warning}`)],
    };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
