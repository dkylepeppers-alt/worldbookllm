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

import { ConflictError, NotFoundError } from '../errors.js';
import { confine, listMarkdownFiles } from './book-paths.js';

export function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

export interface BookFileStat {
  path: string;
  size: number;
  mtimeMs: number;
}

/** Where a book lives on disk (ADR 0018). */
export interface BookLocation {
  slug: string;
  root: string;
  /** The series whose folder holds the book, or null for a standalone book. */
  seriesId: string | null;
  /** A series bible is addressed as the book whose slug is the series id. */
  kind: 'book' | 'series-bible';
}

const SERIES_BIBLE_DIR = 'series-bible';

function holdsBook(dir: string): boolean {
  try {
    return lstatSync(dir).isDirectory() && existsSync(join(dir, 'story.md'));
  } catch {
    return false;
  }
}

function slugDirs(parent: string): string[] {
  try {
    return readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && bookSlugSchema.safeParse(entry.name).success)
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

/**
 * Filesystem access to story-skills books (ADR 0014): standalone books under
 * `data/projects/<slug>/`, and series under `data/series/<id>/` with their
 * books beside a `series-bible/` project (ADR 0018). A slug names one book
 * wherever it lives, so the store finds it by scanning. The files are the
 * source of truth; everything here reads and writes them directly, confined
 * to one book's folder, with atomic writes.
 */
export class BookFileStore {
  readonly projectsDir: string;
  readonly seriesDir: string;
  readonly trashDir: string;
  private locations = new Map<string, BookLocation>();
  private duplicates: BookLocation[] = [];

  constructor(dataDir: string) {
    this.projectsDir = resolve(dataDir, 'projects');
    this.seriesDir = resolve(dataDir, 'series');
    this.trashDir = resolve(dataDir, 'trash');
    mkdirSync(this.projectsDir, { recursive: true });
    mkdirSync(this.seriesDir, { recursive: true });
    this.rescan();
  }

  /**
   * Finds every book: standalone books first, then each series (bible, then
   * books), all in name order. When two folders claim one slug, the first
   * found keeps it and the others are set aside as duplicates.
   */
  rescan(): void {
    const found: BookLocation[] = [];
    for (const slug of slugDirs(this.projectsDir)) {
      found.push({ slug, root: join(this.projectsDir, slug), seriesId: null, kind: 'book' });
    }
    for (const seriesId of slugDirs(this.seriesDir)) {
      const folder = join(this.seriesDir, seriesId);
      found.push({
        slug: seriesId,
        root: join(folder, SERIES_BIBLE_DIR),
        seriesId,
        kind: 'series-bible',
      });
      for (const slug of slugDirs(folder)) {
        if (slug === SERIES_BIBLE_DIR) continue;
        found.push({ slug, root: join(folder, slug), seriesId, kind: 'book' });
      }
    }
    const locations = new Map<string, BookLocation>();
    const duplicates: BookLocation[] = [];
    for (const location of found) {
      if (!holdsBook(location.root)) continue;
      if (locations.has(location.slug)) duplicates.push(location);
      else locations.set(location.slug, location);
    }
    this.locations = locations;
    this.duplicates = duplicates;
  }

  /** Every book, in scan order. */
  listLocations(): BookLocation[] {
    this.rescan();
    return [...this.locations.values()];
  }

  /** Folders whose slug another book already holds; the library reports them. */
  listDuplicates(): BookLocation[] {
    return [...this.duplicates];
  }

  /** Slugs of every book, standalone or in a series, including series bibles. */
  listBooks(): string[] {
    return this.listLocations().map((location) => location.slug);
  }

  /** Whether a slug is taken by any book, series, or leftover folder of that name. */
  exists(slug: string): boolean {
    if (slug === SERIES_BIBLE_DIR) return true;
    if (existsSync(join(this.projectsDir, slug)) || existsSync(join(this.seriesDir, slug))) {
      return true;
    }
    return slugDirs(this.seriesDir).some((seriesId) =>
      existsSync(join(this.seriesDir, seriesId, slug)),
    );
  }

  /** Where an existing book lives. */
  locate(slug: string): BookLocation {
    bookSlugSchema.parse(slug);
    let location = this.locations.get(slug);
    if (location === undefined || !holdsBook(location.root)) {
      this.rescan();
      location = this.locations.get(slug);
    }
    if (location === undefined) throw new NotFoundError(`Book ${slug} was not found`);
    return location;
  }

  /** The absolute root of an existing book. */
  root(slug: string): string {
    return this.locate(slug).root;
  }

  /** Makes the folder for a new series; `story init` then creates its bible inside. */
  createSeriesFolder(seriesId: string): string {
    const folder = confine(this.seriesDir, bookSlugSchema.parse(seriesId));
    mkdirSync(folder);
    return folder;
  }

  /** The folder of an existing series, which new books are created inside. */
  seriesFolder(seriesId: string): string {
    const bible = this.locate(seriesId);
    if (bible.kind !== 'series-bible') throw new NotFoundError(`Series ${seriesId} was not found`);
    return dirname(bible.root);
  }

  /** Deletes a series folder that a failed operation just created. */
  removeSeriesFolder(seriesId: string): void {
    rmSync(confine(this.seriesDir, bookSlugSchema.parse(seriesId)), {
      recursive: true,
      force: true,
    });
    this.rescan();
  }

  /** Moves a standalone book's folder into a series folder, keeping its slug. */
  moveIntoSeries(slug: string, seriesId: string): void {
    const location = this.locate(slug);
    if (location.kind !== 'book' || location.seriesId !== null) {
      throw new ConflictError('already_in_series', `${slug} is already part of a series.`);
    }
    const target = join(this.seriesFolder(seriesId), slug);
    if (existsSync(target)) {
      throw new ConflictError('slug_taken', `${seriesId} already has a folder named ${slug}.`);
    }
    renameSync(location.root, target);
    this.rescan();
  }

  listFiles(slug: string): BookFileStat[] {
    const root = this.root(slug);
    return listMarkdownFiles(root).map((path) => {
      const stats = statSync(join(root, path));
      return { path, size: stats.size, mtimeMs: stats.mtimeMs };
    });
  }

  /** Moves a series book back to projects without changing its slug or deleting any files. */
  moveOutOfSeries(slug: string, seriesId: string): void {
    const location = this.locate(slug);
    if (location.kind !== 'book' || location.seriesId !== seriesId)
      throw new ConflictError('not_series_book', `${slug} is not a book in series ${seriesId}.`);
    const target = confine(this.projectsDir, bookSlugSchema.parse(slug));
    if (existsSync(target))
      throw new ConflictError('slug_taken', `projects already has a folder named ${slug}.`);
    renameSync(location.root, target);
    this.rescan();
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
