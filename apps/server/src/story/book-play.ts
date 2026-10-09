import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BookPlay, PlayPassage } from '@worldbookllm/shared';

import { StoryCommandError } from '../errors.js';
import type { StoryCli } from './story-cli.js';

/** Same allowance as `story build` and `story export`. */
const PLAY_TIMEOUT_MS = 120_000;

/** A link line as story-skills' tweeSource writes it: `[[text->chapter-id]]`. */
const LINK_LINE = /^\[\[([^[\]]+)->([a-z0-9]+(?:-[a-z0-9]+)*)\]\]$/u;

/**
 * Reads the Twee 3 that `story build --format twee` writes (story-skills
 * 0.23.0 tweeSource): StoryTitle, StoryData with the IFID and start, then one
 * passage per chapter named by its id, its prose, and a link line per choice.
 */
export function parseTwee(source: string): Omit<BookPlay, 'warnings'> {
  const sections: { name: string; lines: string[] }[] = [];
  for (const line of source.replace(/\r\n?/gu, '\n').split('\n')) {
    if (line.startsWith(':: ')) sections.push({ name: line.slice(3).trim(), lines: [] });
    // tweeSource escapes a prose line that starts with `::`.
    else sections.at(-1)?.lines.push(line.startsWith('\\::') ? line.slice(1) : line);
  }
  const text = (name: string) =>
    sections
      .find((section) => section.name === name)
      ?.lines.join('\n')
      .trim() ?? '';
  const data = JSON.parse(text('StoryData') || '{}') as { ifid?: unknown; start?: unknown };

  const passages: PlayPassage[] = sections
    .filter((section) => section.name !== 'StoryTitle' && section.name !== 'StoryData')
    .map((section) => {
      const lines = [...section.lines];
      while (lines.length > 0 && lines.at(-1)!.trim() === '') lines.pop();
      const links: PlayPassage['links'] = [];
      for (let match = LINK_LINE.exec(lines.at(-1) ?? ''); match;) {
        links.unshift({ text: match[1]!, to: match[2]! });
        lines.pop();
        match = LINK_LINE.exec(lines.at(-1) ?? '');
      }
      return { id: section.name, prose: lines.join('\n').trim(), links };
    });
  return {
    title: text('StoryTitle'),
    start: typeof data.start === 'string' ? data.start : (passages[0]?.id ?? ''),
    ifid: typeof data.ifid === 'string' ? data.ifid : '',
    passages,
  };
}

/**
 * The book as a playable story: built by `story build --format twee` into an
 * operation-specific temporary folder (never the book's `dist/`), so the
 * play-through has exactly the prose, links, and refusals a real build has.
 */
export async function buildPlay(cli: StoryCli, root: string): Promise<BookPlay> {
  const workDir = mkdtempSync(join(tmpdir(), 'worldbookllm-play-'));
  try {
    const out = join(workDir, 'story.twee');
    const result = await cli.run({
      command: 'build',
      root,
      out,
      options: { format: 'twee' },
      timeoutMs: PLAY_TIMEOUT_MS,
    });
    // Exit 1 means a warning story.md promotes to an error; the file is still written.
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      const message = result.stderr.trim() || result.stdout.trim();
      throw new StoryCommandError(result.exitCode, message || 'story build failed');
    }
    const warnings = `${result.stdout}\n${result.stderr}`
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^(warning|error):/u.test(line))
      // The Branches screen offers to pin the IFID; a play-through need not repeat it.
      .filter((line) => !line.endsWith('[derived-ifid]'));
    return { ...parseTwee(readFileSync(out, 'utf8')), warnings };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
