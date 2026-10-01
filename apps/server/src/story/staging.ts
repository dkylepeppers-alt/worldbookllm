import { randomUUID } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

import type { BookFileKind, StoryOptions } from '@worldbookllm/shared';

import { ConflictError, NotFoundError } from '../errors.js';
import { parseFrontmatter } from './book-index.js';
import { sha256 } from './book-files.js';
import { classifyBookPath, confine, listMarkdownFiles } from './book-paths.js';
import type { StoryCli, StoryRunResult } from './story-cli.js';
import { STORY_COMMANDS, type StoryCommandName } from './story-commands.js';
import { assertWritablePath, needsReindex } from './write-rules.js';

/** One file a staged turn changed; null content means the file did not exist. */
export interface StagedChange {
  path: string;
  before: Buffer | null;
  after: Buffer | null;
}

export interface StagedFile {
  path: string;
  kind: BookFileKind;
  title: string;
}

/** Commands whose output goes to dist/, which a staged copy does not keep. */
const OUTPUT_COMMANDS = new Set<string>(['build', 'export']);
const EXCERPT_RADIUS = 120;
const SEARCH_LIMIT = 25;

function titleOf(content: string, path: string, entityId: string | null): string {
  const { frontmatter } = parseFrontmatter(content);
  for (const key of ['title', 'name', 'term']) {
    const value = frontmatter?.[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return entityId ?? path;
}

/**
 * A scratch copy of a book for a review-mode agent turn (ADR 0016). The
 * agent reads, writes, and runs story commands against the copy, so it sees
 * its own work while the real book stays untouched. When the turn ends,
 * `changes()` compares the copy with the book as it was copied: those are
 * the proposed changes the writer reviews. Generated registries are left
 * out; applying changes reindexes the real book instead.
 */
export class StagedBook {
  private readonly baseline = new Map<string, Buffer>();

  private constructor(
    readonly book: string,
    readonly root: string,
    private readonly cli: StoryCli,
  ) {}

  /** Copies a book's folder (without dist/ and dot-entries) into `stagingDir`. */
  static create(book: string, sourceRoot: string, stagingDir: string, cli: StoryCli): StagedBook {
    mkdirSync(stagingDir, { recursive: true });
    const root = join(stagingDir, randomUUID());
    try {
      cpSync(sourceRoot, root, {
        recursive: true,
        filter: (source) => {
          const path = relative(sourceRoot, source);
          if (path === '') return true;
          const segments = path.split(sep);
          if (segments.some((segment) => segment.startsWith('.'))) return false;
          return segments[0] !== 'dist';
        },
      });
      const staged = new StagedBook(book, root, cli);
      for (const path of listMarkdownFiles(root)) {
        staged.baseline.set(path, readFileSync(join(root, path)));
      }
      return staged;
    } catch (error) {
      // Nothing owns a copy that failed partway, so it is removed here.
      rmSync(root, { recursive: true, force: true });
      throw error;
    }
  }

  private bytes(path: string): Buffer | null {
    try {
      return readFileSync(confine(this.root, path));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  readFile(path: string): { path: string; hash: string; content: string } {
    const bytes = path.endsWith('.md') ? this.bytes(path) : null;
    if (bytes === null) throw new NotFoundError(`${path} was not found in ${this.book}`);
    return { path, hash: sha256(bytes), content: bytes.toString('utf8') };
  }

  listFiles(): StagedFile[] {
    return listMarkdownFiles(this.root).map((path) => {
      const { kind, entityId } = classifyBookPath(path);
      const content = readFileSync(join(this.root, path), 'utf8');
      return { path, kind, title: titleOf(content, path, entityId) };
    });
  }

  /** Case-insensitive substring search over the copy (the real index does not cover it). */
  search(query: string): Array<{ path: string; title: string; excerpt: string }> {
    const needle = query.trim().toLowerCase();
    if (needle === '') return [];
    const hits: Array<{ path: string; title: string; excerpt: string }> = [];
    for (const path of listMarkdownFiles(this.root)) {
      if (classifyBookPath(path).kind === 'registry') continue;
      const content = readFileSync(join(this.root, path), 'utf8');
      const at = content.toLowerCase().indexOf(needle);
      if (at === -1) continue;
      const start = Math.max(0, at - EXCERPT_RADIUS);
      const excerpt = content
        .slice(start, at + needle.length + EXCERPT_RADIUS)
        .replace(/\s+/gu, ' ')
        .trim();
      hits.push({
        path,
        title: titleOf(content, path, classifyBookPath(path).entityId),
        excerpt,
      });
      if (hits.length === SEARCH_LIMIT) break;
    }
    return hits;
  }

  async writeFile(path: string, content: string, expectedHash: string | null): Promise<void> {
    assertWritablePath(path);
    const current = this.bytes(path);
    const currentHash = current === null ? null : sha256(current);
    if (currentHash !== expectedHash) {
      throw new ConflictError(
        'file_changed',
        current === null
          ? `${path} does not exist anymore.`
          : expectedHash === null
            ? `${path} already exists.`
            : `${path} changed since it was read.`,
      );
    }
    await this.put(path, content);
  }

  async editFile(path: string, find: string, replace: string): Promise<void> {
    assertWritablePath(path);
    const bytes = this.bytes(path);
    if (bytes === null) throw new NotFoundError(`${path} was not found in ${this.book}`);
    const current = bytes.toString('utf8');
    let occurrences = 0;
    let offset = 0;
    while ((offset = current.indexOf(find, offset)) !== -1) {
      occurrences += 1;
      offset += 1;
    }
    if (occurrences !== 1) {
      throw new Error(
        occurrences === 0
          ? `The passage to replace was not found in ${path}.`
          : `The passage occurs ${occurrences} times in ${path}; include more context so it is unique.`,
      );
    }
    await this.put(
      path,
      current.replace(find, () => replace),
    );
  }

  runStory(
    command: StoryCommandName,
    args: string[],
    options: StoryOptions,
  ): Promise<StoryRunResult> {
    if (OUTPUT_COMMANDS.has(command)) {
      throw new Error(
        `story ${command} writes build output, which review mode does not keep. Ask the writer to turn review mode off to build.`,
      );
    }
    const json = Object.hasOwn(STORY_COMMANDS[command].options, 'json');
    return this.cli.run({ command, root: this.root, args, options, json });
  }

  /** Files that differ from the book as copied, registries excluded. */
  changes(): StagedChange[] {
    const current = new Map<string, Buffer>();
    for (const path of listMarkdownFiles(this.root)) {
      current.set(path, readFileSync(join(this.root, path)));
    }
    const changes: StagedChange[] = [];
    for (const path of [...new Set([...this.baseline.keys(), ...current.keys()])].sort()) {
      if (classifyBookPath(path).kind === 'registry') continue;
      const before = this.baseline.get(path) ?? null;
      const after = current.get(path) ?? null;
      if (before !== null && after !== null && before.equals(after)) continue;
      changes.push({ path, before, after });
    }
    return changes;
  }

  dispose(): void {
    rmSync(this.root, { recursive: true, force: true });
  }

  /** Writes a staged file; a failed reindex restores every Markdown file, as on the real book. */
  private async put(path: string, content: string): Promise<void> {
    const absolute = confine(this.root, path);
    const before = needsReindex(path) ? this.markdown() : null;
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
    if (before === null) return;
    try {
      await this.cli.runOrThrow({ command: 'reindex', root: this.root });
    } catch (error) {
      for (const [file, bytes] of this.markdown()) {
        const previous = before.get(file);
        if (previous === undefined) rmSync(join(this.root, file), { force: true });
        else if (!previous.equals(bytes)) writeFileSync(join(this.root, file), previous);
      }
      for (const [file, bytes] of before) {
        const target = join(this.root, file);
        mkdirSync(dirname(target), { recursive: true });
        if (this.bytes(file) === null) writeFileSync(target, bytes);
      }
      throw error;
    }
  }

  private markdown(): Map<string, Buffer> {
    return new Map(
      listMarkdownFiles(this.root).map((file) => [file, readFileSync(join(this.root, file))]),
    );
  }
}
