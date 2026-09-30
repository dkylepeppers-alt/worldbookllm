import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { UnsafePathError } from '../errors.js';
import { classifyBookPath, confine, listMarkdownFiles } from './book-paths.js';

let root: string;
let outside: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'worldbookllm-book-'));
  outside = mkdtempSync(join(tmpdir(), 'worldbookllm-outside-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe('confine', () => {
  it('resolves ordinary relative paths inside the root', () => {
    expect(confine(root, 'characters/sera-voss.md')).toBe(join(root, 'characters/sera-voss.md'));
  });

  it.each([
    '',
    '/etc/passwd',
    '../secrets.json',
    'characters/../../x.md',
    'characters//x.md',
    './story.md',
    '.git/config',
    'characters/.hidden.md',
    'a\\b.md',
    'a\0b.md',
  ])('refuses %j', (path) => {
    expect(() => confine(root, path)).toThrow(UnsafePathError);
  });

  it('refuses a path that passes through a symlink', () => {
    symlinkSync(outside, join(root, 'characters'));
    expect(() => confine(root, 'characters/x.md')).toThrow(UnsafePathError);
    writeFileSync(join(outside, 'target.md'), 'x');
    symlinkSync(join(outside, 'target.md'), join(root, 'link.md'));
    expect(() => confine(root, 'link.md')).toThrow(UnsafePathError);
  });
});

describe('listMarkdownFiles', () => {
  it('lists Markdown files, skipping dot-entries, symlinks, and dist/', () => {
    mkdirSync(join(root, 'characters'));
    mkdirSync(join(root, 'dist'));
    mkdirSync(join(root, '.git'));
    writeFileSync(join(root, 'story.md'), '');
    writeFileSync(join(root, 'characters/a.md'), '');
    writeFileSync(join(root, 'characters/notes.txt'), '');
    writeFileSync(join(root, 'dist/manuscript.md'), '');
    writeFileSync(join(root, '.git/HEAD.md'), '');
    writeFileSync(join(root, '.draft.md'), '');
    writeFileSync(join(outside, 'x.md'), '');
    symlinkSync(join(outside, 'x.md'), join(root, 'linked.md'));
    expect(listMarkdownFiles(root)).toEqual(['characters/a.md', 'story.md']);
  });
});

describe('classifyBookPath', () => {
  it.each([
    ['story.md', 'story', null],
    ['plot/timeline.md', 'timeline', null],
    ['continuity/state.md', 'state', null],
    ['characters/_index.md', 'registry', null],
    ['characters/sera-voss.md', 'character', 'sera-voss'],
    ['worldbuilding/locations/port-kestrel.md', 'location', 'port-kestrel'],
    ['continuity/clues/the-key.md', 'clue', 'the-key'],
    ['glossary/terms/ember.md', 'term', 'ember'],
    ['research/harbor-lore.md', 'research', 'harbor-lore'],
    ['characters/minor/old-nell.md', 'other', null],
    ['notes/ideas.md', 'other', null],
  ])('classifies %s as %s', (path, kind, entityId) => {
    expect(classifyBookPath(path)).toEqual({ kind, entityId });
  });
});
