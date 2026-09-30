import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { bookSlugSchema } from '@worldbookllm/shared';

import { NotFoundError } from '../errors.js';
import { confine, listMarkdownFiles } from './book-paths.js';

export function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

export interface BookFileStat {
  path: string;
  size: number;
  mtimeMs: number;
}

/**
 * Filesystem access to story-skills books under `data/projects/` (ADR 0014).
 * The files are the source of truth; everything here reads and writes them
 * directly, confined to one book's folder, with atomic writes.
 */
export class BookFileStore {
  readonly projectsDir: string;
  readonly trashDir: string;

  constructor(dataDir: string) {
    this.projectsDir = resolve(dataDir, 'projects');
    this.trashDir = resolve(dataDir, 'trash');
    mkdirSync(this.projectsDir, { recursive: true });
  }

  /** Slugs of every folder under projects/ that holds a story.md. */
  listBooks(): string[] {
    return readdirSync(this.projectsDir, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          bookSlugSchema.safeParse(entry.name).success &&
          existsSync(join(this.projectsDir, entry.name, 'story.md')),
      )
      .map((entry) => entry.name)
      .sort();
  }

  exists(slug: string): boolean {
    return existsSync(join(this.projectsDir, slug));
  }

  /** The absolute root of an existing book. */
  root(slug: string): string {
    const root = confine(this.projectsDir, bookSlugSchema.parse(slug));
    if (!existsSync(join(root, 'story.md')) || !lstatSync(root).isDirectory()) {
      throw new NotFoundError(`Book ${slug} was not found`);
    }
    return root;
  }

  listFiles(slug: string): BookFileStat[] {
    const root = this.root(slug);
    return listMarkdownFiles(root).map((path) => {
      const stats = statSync(join(root, path));
      return { path, size: stats.size, mtimeMs: stats.mtimeMs };
    });
  }

  /** Raw bytes of a book file, or null when it does not exist. */
  readBytes(slug: string, path: string): Buffer | null {
    const absolute = confine(this.root(slug), path);
    try {
      return readFileSync(absolute);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  stat(slug: string, path: string): BookFileStat | null {
    const absolute = confine(this.root(slug), path);
    try {
      const stats = statSync(absolute);
      return stats.isFile() ? { path, size: stats.size, mtimeMs: stats.mtimeMs } : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  /** Writes a file atomically (temp file, fsync, rename), creating parent folders. */
  write(slug: string, path: string, content: string | Buffer): void {
    const absolute = confine(this.root(slug), path);
    mkdirSync(dirname(absolute), { recursive: true });
    const temporary = join(dirname(absolute), `.${randomUUID()}.wbl-tmp`);
    let descriptor: number | undefined;
    try {
      descriptor = openSync(temporary, 'wx', 0o644);
      writeFileSync(descriptor, content);
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      renameSync(temporary, absolute);
    } catch (error) {
      if (descriptor !== undefined) closeSync(descriptor);
      rmSync(temporary, { force: true });
      throw error;
    }
  }

  remove(slug: string, path: string): void {
    const absolute = confine(this.root(slug), path);
    try {
      unlinkSync(absolute);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  /** Every Markdown file's bytes, keyed by path: the "before" image of a book-wide change. */
  snapshot(slug: string): Map<string, Buffer> {
    const root = this.root(slug);
    const files = new Map<string, Buffer>();
    for (const path of listMarkdownFiles(root)) files.set(path, readFileSync(join(root, path)));
    return files;
  }

  /** Moves a book folder to data/trash/ rather than deleting it outright. */
  trash(slug: string): void {
    const root = this.root(slug);
    mkdirSync(this.trashDir, { recursive: true });
    const stamp = new Date().toISOString().replaceAll(':', '-');
    renameSync(root, join(this.trashDir, `${slug}-${stamp}`));
  }
}
