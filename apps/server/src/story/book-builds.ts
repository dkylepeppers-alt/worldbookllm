import { lstatSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { BookBuildFile } from '@worldbookllm/shared';

import { NotFoundError } from '../errors.js';
import { confine } from './book-paths.js';

/** The folder `story build` writes into; never indexed or checkpointed (see book-paths). */
const DIST = 'dist';

const CONTENT_TYPES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\.epub$/u, 'application/epub+zip'],
  [/\.docx$/u, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  [/\.html?$/u, 'text/html; charset=utf-8'],
  [/\.md$/u, 'text/markdown; charset=utf-8'],
  [/\.(fountain|twee|ink|txt)$/u, 'text/plain; charset=utf-8'],
];

/** The download content type for a build file, from its extension. */
export function buildContentType(name: string): string {
  const lower = name.toLowerCase();
  return CONTENT_TYPES.find(([pattern]) => pattern.test(lower))?.[1] ?? 'application/octet-stream';
}

/** The absolute path of `dist/<name>` in a book, refusing anything but a plain file there. */
function buildFilePath(root: string, name: string): string {
  const path = confine(root, `${DIST}/${name}`);
  let isFile = false;
  try {
    isFile = lstatSync(path).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (!isFile) throw new NotFoundError(`Build file ${name} was not found`);
  return path;
}

export function readBuildFile(root: string, name: string): Buffer {
  return readFileSync(buildFilePath(root, name));
}

/** Replaces an existing build file's content, as a build that rewrites its output would. */
export function writeBuildFile(root: string, name: string, content: string): void {
  writeFileSync(buildFilePath(root, name), content);
}

export function removeBuildFile(root: string, name: string): void {
  rmSync(buildFilePath(root, name));
}

/** Files directly in the book's `dist/`, newest first. Symlinks and dot-files are skipped. */
export function listBuildFiles(root: string): BookBuildFile[] {
  let dist: string;
  try {
    dist = confine(root, DIST);
    if (!lstatSync(dist).isDirectory()) return [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return readdirSync(dist, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
    .flatMap((entry) => {
      let stats;
      try {
        stats = lstatSync(join(dist, entry.name));
      } catch (error) {
        // Removed since the directory was read (by the agent's own story build, say).
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
      }
      return [
        { name: entry.name, size: stats.size, updatedAt: new Date(stats.mtimeMs).toISOString() },
      ];
    })
    .sort(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) || left.name.localeCompare(right.name),
    );
}

/**
 * The file a `story build` run reported writing, from its confirmation line
 * (`Built 3 chapters as epub to ./dist/the-salt-road.epub` once StoryCli has
 * rewritten the book root to `.`). Null when the line names no `dist/` file.
 */
export function builtFileName(stdout: string): string | null {
  const match = /\bto \.\/dist\/([^/\r\n]+?)\s*$/mu.exec(stdout);
  return match?.[1] ?? null;
}
