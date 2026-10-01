import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BookManuscript } from '@worldbookllm/shared';

import { StoryCommandError } from '../errors.js';
import type { StoryCli } from './story-cli.js';

/** A long book takes a while to assemble; same allowance as `story build`. */
const EXPORT_TIMEOUT_MS = 120_000;

/** `story export`'s refusal for a project without chapters (cli-reference, "export"). */
const NO_CHAPTERS = /^No chapters found to export\b/u;

/**
 * The book's manuscript for reading, assembled by `story export` exactly as
 * a build would: chapter prose and matter pages, no frontmatter, outlines,
 * or notes. The CLI writes it to an operation-specific temporary folder
 * (never into the book or its `dist/`), which is removed afterwards.
 */
export async function exportManuscript(cli: StoryCli, root: string): Promise<BookManuscript> {
  const workDir = mkdtempSync(join(tmpdir(), 'worldbookllm-manuscript-'));
  try {
    const out = join(workDir, 'manuscript.md');
    const result = await cli.run({ command: 'export', root, out, timeoutMs: EXPORT_TIMEOUT_MS });
    // Exit 1 means a warning story.md promotes to an error; the manuscript is still written.
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      const message = (result.stderr.trim() || result.stdout.trim()).split('\n')[0] ?? '';
      // A book without chapters is not broken, just empty. Every other refusal
      // (a missing or unreadable story.md, a newer schema, …) is a real error.
      if (NO_CHAPTERS.test(message)) return { markdown: '', warnings: [] };
      throw new StoryCommandError(result.exitCode, message || 'story export failed');
    }
    const warnings = result.stderr
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^(warning|error):/u.test(line));
    return { markdown: readFileSync(out, 'utf8'), warnings };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
