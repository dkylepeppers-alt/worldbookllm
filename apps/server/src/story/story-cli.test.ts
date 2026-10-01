import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { StoryCommandError } from '../errors.js';
import { StoryCli } from './story-cli.js';

const tempDirs: string[] = [];

function tempDir(): string {
  const directory = mkdtempSync(join(tmpdir(), 'worldbookllm-story-cli-'));
  tempDirs.push(directory);
  return directory;
}

/** A stand-in for bin/story.js, for behaviors the real CLI cannot be made to show. */
function fakeBin(source: string): string {
  const path = join(tempDir(), 'fake-story.mjs');
  writeFileSync(path, source);
  return path;
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('StoryCli.buildArgv', () => {
  const cli = new StoryCli('/story.js');

  it('puts validated flags first, then the server --path, then -- and positionals', () => {
    expect(
      cli.buildArgv({
        command: 'add',
        root: '/data/projects/book',
        args: ['character', '--force'],
        options: { role: 'protagonist', aliases: ['Sera', '--x'], sequel: true },
      }),
    ).toEqual([
      '/story.js',
      'add',
      '--role=protagonist',
      '--aliases=Sera',
      '--aliases=--x',
      '--sequel=true',
      '--path=/data/projects/book',
      '--',
      'character',
      '--force',
    ]);
  });

  it('uses --dir and no --path for commands that create a project', () => {
    expect(
      cli.buildArgv({ command: 'init', cwd: '/data/projects', dir: 'b', args: ['B'] }),
    ).toEqual(['/story.js', 'init', '--dir=b', '--', 'B']);
  });

  it.each(['path', 'out', 'dir', 'json'])('refuses the server-owned flag --%s', (flag) => {
    expect(() => cli.buildArgv({ command: 'build', root: '/r', options: { [flag]: 'x' } })).toThrow(
      StoryCommandError,
    );
  });

  it('refuses unknown commands, unknown flags, and mistyped values', () => {
    expect(() => cli.buildArgv({ command: 'bogus' as 'add', root: '/r' })).toThrow(
      /Unknown story command/u,
    );
    expect(() =>
      cli.buildArgv({ command: 'validate', root: '/r', options: { force: true } }),
    ).toThrow(/does not accept --force/u);
    expect(() => cli.buildArgv({ command: 'add', root: '/r', options: { role: true } })).toThrow(
      /needs a text value/u,
    );
    expect(() => cli.buildArgv({ command: 'add', root: '/r', options: { sequel: 'yes' } })).toThrow(
      /true\/false flag/u,
    );
    expect(() =>
      cli.buildArgv({ command: 'add', root: '/r', options: { role: ['a', 'b'] } }),
    ).toThrow(/single value/u);
  });

  it('caps positionals and never passes a positional project path', () => {
    expect(() => cli.buildArgv({ command: 'validate', root: '/r', args: ['/etc'] })).toThrow(
      /at most 0/u,
    );
    expect(() => cli.buildArgv({ command: 'remove', root: '/r', args: ['a', 'b', 'c'] })).toThrow(
      /at most 2/u,
    );
  });

  it('passes a server-chosen absolute --out only to commands that take one', () => {
    expect(cli.buildArgv({ command: 'export', root: '/books/b', out: '/tmp/m.md' })).toEqual([
      '/story.js',
      'export',
      '--path=/books/b',
      '--out=/tmp/m.md',
      '--',
    ]);
    expect(() => cli.buildArgv({ command: 'export', root: '/books/b', out: 'dist/m.md' })).toThrow(
      'cannot write to that --out',
    );
    expect(() =>
      cli.buildArgv({ command: 'validate', root: '/books/b', out: '/tmp/m.md' }),
    ).toThrow('cannot write to that --out');
    expect(() =>
      cli.buildArgv({ command: 'export', root: '/books/b', options: { out: '/tmp/m.md' } }),
    ).toThrow('does not accept --out');
  });

  it('refuses NUL characters and --json on commands without JSON output', () => {
    expect(() => cli.buildArgv({ command: 'add', root: '/r', args: ['a\0b'] })).toThrow(/NUL/u);
    expect(() => cli.buildArgv({ command: 'add', root: '/r', json: true })).toThrow(/no --json/u);
  });
});

describe('StoryCli.run with the pinned CLI', () => {
  it('creates a project, reads JSON results, and hides the absolute root', async () => {
    const cli = new StoryCli();
    const cwd = tempDir();
    await cli.runOrThrow({ command: 'init', cwd, dir: 'salt-road', args: ['The Salt Road'] });
    const root = join(cwd, 'salt-road');
    expect(existsSync(join(root, 'story.md'))).toBe(true);

    const report = await cli.run({ command: 'report', root, json: true });
    expect(report.exitCode).toBe(0);
    expect(report.envelope).toMatchObject({ command: 'report', ok: true });
    expect(report.stdout).not.toContain(root);
    expect((report.envelope?.data as { root: string }).root).toBe('.');

    const added = await cli.runOrThrow({ command: 'add', root, args: ['character', '--force'] });
    expect(added.stdout).toContain('./characters/force.md');
    expect(added.stdout).not.toContain(cwd);
  });

  it('turns a refused write into a StoryCommandError carrying the exit code', async () => {
    const cli = new StoryCli();
    const cwd = tempDir();
    await cli.runOrThrow({ command: 'init', cwd, dir: 'b', args: ['B'] });
    const root = join(cwd, 'b');
    await cli.runOrThrow({ command: 'add', root, args: ['character', 'Mara'] });
    const error = await cli
      .runOrThrow({ command: 'add', root, args: ['character', 'Mara'] })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(StoryCommandError);
    expect(error).toMatchObject({ exitCode: 4, message: 'characters/mara.md already exists' });
  });
});

describe('StoryCli.run process limits', () => {
  it('passes only a scrubbed environment', async () => {
    process.env.WORLDBOOKLLM_TEST_SECRET = 'leak';
    try {
      const cli = new StoryCli(
        fakeBin('process.stdout.write(JSON.stringify(Object.keys(process.env).sort()));'),
      );
      const result = await cli.run({ command: 'reindex', root: tempDir() });
      const keys = JSON.parse(result.stdout) as string[];
      expect(keys).not.toContain('WORLDBOOKLLM_TEST_SECRET');
      expect(keys).toEqual(expect.arrayContaining(['HOME', 'NO_COLOR', 'PATH']));
    } finally {
      delete process.env.WORLDBOOKLLM_TEST_SECRET;
    }
  });

  it('stops a command that runs past its timeout', async () => {
    const cli = new StoryCli(fakeBin('setTimeout(() => {}, 60_000);'));
    await expect(cli.run({ command: 'reindex', root: tempDir(), timeoutMs: 300 })).rejects.toThrow(
      /did not finish/u,
    );
  });

  it('stops a command whose output exceeds the cap', async () => {
    const cli = new StoryCli(fakeBin("process.stdout.write('x'.repeat(2 * 1024 * 1024));"));
    await expect(cli.run({ command: 'reindex', root: tempDir() })).rejects.toThrow(/1 MB/u);
  });

  it('rewrites the root only as a whole path, never inside a sibling path', async () => {
    const root = tempDir();
    const text = `root ${root}/a.md, sibling ${root}-2/b.md, bare ${root}`;
    const cli = new StoryCli(fakeBin(`process.stdout.write(${JSON.stringify(text)});`));
    const result = await cli.run({ command: 'reindex', root });
    expect(result.stdout).toBe(`root ./a.md, sibling ${root}-2/b.md, bare .`);
  });

  it('reports a non-zero exit as data rather than an error', async () => {
    const root = tempDir();
    const cli = new StoryCli(
      fakeBin(`process.stdout.write(${JSON.stringify(`found in ${root}/x.md`)}); process.exit(1);`),
    );
    const result = await cli.run({ command: 'reindex', root });
    expect(result).toMatchObject({ exitCode: 1, stdout: 'found in ./x.md' });
  });
});
