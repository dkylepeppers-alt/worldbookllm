import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import type { BookFileKind } from '@worldbookllm/shared';

import { UnsafePathError } from '../errors.js';

/**
 * Resolves a book-relative POSIX path to an absolute path inside `root`,
 * refusing anything that could reach outside it or into hidden state:
 * absolute paths, `..` segments, empty segments, dot-files and
 * dot-directories (`.git`, `.story.lock`), and symlinks anywhere along the
 * way. Every file access inside a book goes through this one helper.
 */
export function confine(root: string, relativePath: string): string {
  if (
    relativePath.length === 0 ||
    isAbsolute(relativePath) ||
    relativePath.includes('\\') ||
    relativePath.includes('\0')
  ) {
    throw new UnsafePathError(relativePath);
  }
  const segments = relativePath.split('/');
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..' || segment.startsWith('.')) {
      throw new UnsafePathError(relativePath);
    }
  }
  const absolute = resolve(root, ...segments);
  const fromRoot = relative(root, absolute);
  if (fromRoot === '' || fromRoot.startsWith(`..${sep}`) || fromRoot === '..') {
    throw new UnsafePathError(relativePath);
  }

  // Walk the existing prefix of the path: no component may be a symlink.
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    let stats;
    try {
      stats = lstatSync(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
      throw error;
    }
    if (stats.isSymbolicLink()) throw new UnsafePathError(relativePath);
  }
  return absolute;
}

/** Top-level folders the CLI writes disposable output into; never indexed or checkpointed. */
const IGNORED_TOP_LEVEL = new Set(['dist']);

/**
 * Lists every Markdown file in a book as a book-relative POSIX path, skipping
 * dot-entries, symlinks, and `dist/`. Sorted for stable output.
 */
export function listMarkdownFiles(root: string): string[] {
  const files: string[] = [];
  const realRoot = realpathSync(root);
  const walk = (directory: string, prefix: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      if (prefix === '' && IGNORED_TOP_LEVEL.has(entry.name)) continue;
      const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(join(directory, entry.name), relativePath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(relativePath);
      }
    }
  };
  walk(realRoot, '');
  return files.sort();
}

const ENTITY_DIRECTORIES: ReadonlyArray<readonly [string, BookFileKind]> = [
  ['characters', 'character'],
  ['worldbuilding/locations', 'location'],
  ['worldbuilding/systems', 'system'],
  ['worldbuilding/factions', 'faction'],
  ['worldbuilding/artifacts', 'artifact'],
  ['plot/arcs', 'arc'],
  ['chapters', 'chapter'],
  ['scenes', 'scene'],
  ['continuity/questions', 'question'],
  ['continuity/promises', 'promise'],
  ['continuity/clues', 'clue'],
  ['glossary/terms', 'term'],
  ['matter', 'matter'],
  ['research', 'research'],
];

const SINGLETONS: Readonly<Record<string, BookFileKind>> = {
  'story.md': 'story',
  'style-sheet.md': 'style-sheet',
  'progress.md': 'progress',
  'plot/timeline.md': 'timeline',
  'continuity/state.md': 'state',
  'continuity/exemptions.md': 'exemptions',
};

/**
 * What a book file is, from its path alone, following the story-skills
 * project layout (schema v2): an entity's id is its filename without `.md`,
 * entity directories are flat, and `_index.md` files are generated
 * registries.
 */
export function classifyBookPath(path: string): { kind: BookFileKind; entityId: string | null } {
  const singleton = SINGLETONS[path];
  if (singleton) return { kind: singleton, entityId: null };
  const slash = path.lastIndexOf('/');
  const directory = slash === -1 ? '' : path.slice(0, slash);
  const fileName = path.slice(slash + 1);
  if (fileName === '_index.md') return { kind: 'registry', entityId: null };
  for (const [entityDirectory, kind] of ENTITY_DIRECTORIES) {
    if (directory === entityDirectory && fileName.endsWith('.md')) {
      return { kind, entityId: fileName.slice(0, -'.md'.length) };
    }
  }
  return { kind: 'other', entityId: null };
}
