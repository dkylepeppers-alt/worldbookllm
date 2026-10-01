import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { isAbsolute } from 'node:path';

import { storyEnvelopeSchema, type StoryEnvelope, type StoryOptions } from '@worldbookllm/shared';

import { StoryCommandError } from '../errors.js';
import { STORY_COMMANDS, isStoryCommand, type StoryCommandName } from './story-commands.js';

/** Flags StoryCli sets itself; callers can never pass them (ADR 0015 decision 4). */
const SERVER_OWNED_OPTIONS = new Set(['path', 'out', 'dir', 'json']);

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;

export interface StoryRunRequest {
  command: StoryCommandName;
  /** Book root for commands that operate on a project (`--path`). */
  root?: string;
  /** Working directory for commands that create a project (`init`, `import`). */
  cwd?: string;
  /** Target folder name for `init`/`import`, relative to `cwd`. */
  dir?: string;
  /** Absolute output file for commands that take `--out`; set by the server, never a caller. */
  out?: string;
  args?: readonly string[];
  options?: StoryOptions;
  json?: boolean;
  timeoutMs?: number;
}

export interface StoryRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** Parsed `--json` envelope when one was requested and printed. */
  envelope: StoryEnvelope | null;
}

function resolveStoryBin(): string {
  return createRequire(import.meta.url).resolve('story-skills/bin/story.js');
}

function assertNoNul(value: string, what: string): void {
  if (value.includes('\0')) throw new StoryCommandError(2, `${what} cannot contain NUL characters`);
}

/**
 * The only code that runs the pinned `story` CLI (ADR 0014 decision 3). Each
 * invocation is validated against the vendored command table, spawned with
 * `execFile` (never a shell) under a timeout, an output cap, and a scrubbed
 * environment, and has every occurrence of the book root rewritten to `.` so
 * absolute server paths never reach a client.
 *
 * Arguments are laid out as `<command> <validated flags> --path <root>
 * [--json] -- <positionals>`: the server's `--path` comes after every caller
 * flag, and `--` makes positionals (entity names, ids) plain text even when
 * they start with dashes.
 */
export class StoryCli {
  private readonly bin: string;

  constructor(bin: string = resolveStoryBin()) {
    this.bin = bin;
  }

  buildArgv(request: StoryRunRequest): string[] {
    if (!isStoryCommand(request.command)) {
      throw new StoryCommandError(2, `Unknown story command: ${String(request.command)}`);
    }
    const spec = STORY_COMMANDS[request.command];
    const argv = [this.bin, request.command];

    for (const [name, value] of Object.entries(request.options ?? {})) {
      const option = (spec.options as Record<string, { value: boolean; repeatable: boolean }>)[
        name
      ];
      if (!option || SERVER_OWNED_OPTIONS.has(name)) {
        throw new StoryCommandError(2, `story ${request.command} does not accept --${name}`);
      }
      if (option.value) {
        const values = Array.isArray(value) ? value : [value];
        if (values.length > 1 && !option.repeatable) {
          throw new StoryCommandError(2, `--${name} takes a single value`);
        }
        for (const entry of values) {
          if (typeof entry !== 'string' || entry.length === 0) {
            throw new StoryCommandError(2, `--${name} needs a text value`);
          }
          assertNoNul(entry, `--${name}`);
          // `--name=value` keeps a value that starts with dashes from being read as a flag.
          argv.push(`--${name}=${entry}`);
        }
      } else {
        if (typeof value !== 'boolean') {
          throw new StoryCommandError(2, `--${name} is a true/false flag`);
        }
        argv.push(`--${name}=${value ? 'true' : 'false'}`);
      }
    }

    if (spec.project === 'none') {
      if (!request.cwd) throw new StoryCommandError(2, `story ${request.command} needs a cwd`);
      if (request.dir !== undefined) {
        assertNoNul(request.dir, '--dir');
        argv.push(`--dir=${request.dir}`);
      }
    } else {
      if (!request.root) throw new StoryCommandError(2, `story ${request.command} needs a book`);
      argv.push(`--path=${request.root}`);
    }

    if (request.out !== undefined) {
      if (!Object.hasOwn(spec.options, 'out') || !isAbsolute(request.out)) {
        throw new StoryCommandError(2, `story ${request.command} cannot write to that --out`);
      }
      assertNoNul(request.out, '--out');
      argv.push(`--out=${request.out}`);
    }

    if (request.json) {
      if (!Object.hasOwn(spec.options, 'json')) {
        throw new StoryCommandError(2, `story ${request.command} has no --json output`);
      }
      argv.push('--json');
    }

    const args = request.args ?? [];
    // For "positional" commands the only positional slot is the project path,
    // which StoryCli supplies through --path.
    const maxArgs = spec.project === 'positional' ? 0 : spec.maxArgs;
    if (maxArgs !== null && args.length > maxArgs) {
      throw new StoryCommandError(2, `story ${request.command} takes at most ${maxArgs} arguments`);
    }
    for (const arg of args) assertNoNul(arg, 'Arguments');
    argv.push('--', ...args);
    return argv;
  }

  async run(request: StoryRunRequest): Promise<StoryRunResult> {
    const argv = this.buildArgv(request);
    const workingDir = request.root ?? request.cwd ?? tmpdir();
    const { exitCode, stdout, stderr } = await spawnStory(argv, {
      cwd: workingDir,
      timeoutMs: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });

    const scrub = makeScrubber(workingDir);
    const cleanStdout = scrub(stdout);
    const cleanStderr = scrub(stderr);
    let envelope: StoryEnvelope | null = null;
    if (request.json) {
      try {
        envelope = storyEnvelopeSchema.parse(JSON.parse(cleanStdout));
      } catch {
        envelope = null;
      }
    }
    return { exitCode, stdout: cleanStdout, stderr: cleanStderr, envelope };
  }

  /** Runs a command that must succeed; a non-zero exit becomes a StoryCommandError. */
  async runOrThrow(request: StoryRunRequest): Promise<StoryRunResult> {
    const result = await this.run(request);
    if (result.exitCode !== 0) {
      const message =
        firstDiagnostic(result.envelope) ??
        (result.stderr.trim() || result.stdout.trim() || `story ${request.command} failed`);
      throw new StoryCommandError(result.exitCode, message);
    }
    return result;
  }
}

function firstDiagnostic(envelope: StoryEnvelope | null): string | null {
  const diagnostic = envelope?.diagnostics.find((entry) => entry.severity === 'error');
  return diagnostic?.message ?? null;
}

/**
 * Rewrites the working directory (and its realpath) to `.` in CLI output. A
 * root only matches as a whole path — followed by a separator, the end, or
 * punctuation — so `/data/projects/b` never rewrites part of a sibling like
 * `/data/projects/b-2`. JSON output escapes Windows backslashes, so each
 * root is also matched in its JSON-escaped spelling.
 */
function makeScrubber(workingDir: string): (text: string) => string {
  const roots = new Set([workingDir]);
  try {
    roots.add(realpathSync(workingDir));
  } catch {
    // A directory that does not exist yet (or was just removed) has no realpath.
  }
  const spellings = new Set<string>();
  for (const root of roots) {
    spellings.add(root);
    spellings.add(JSON.stringify(root).slice(1, -1));
  }
  const patterns = [...spellings]
    .sort((left, right) => right.length - left.length)
    .map((root) => new RegExp(`${escapeRegExp(root)}(?=$|[\\\\/\\s"'\`:,;)\\]])`, 'gu'));
  return (text) => patterns.reduce((result, pattern) => result.replace(pattern, '.'), text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

interface SpawnOptions {
  cwd: string;
  timeoutMs: number;
}

function scrubbedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? '',
    HOME: tmpdir(),
    NO_COLOR: '1',
  };
  // Node on Windows cannot start without these.
  if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
  if (process.env.TEMP) env.TEMP = process.env.TEMP;
  return env;
}

function spawnStory(
  argv: string[],
  options: SpawnOptions,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      argv,
      {
        cwd: options.cwd,
        env: scrubbedEnv(),
        timeout: options.timeoutMs,
        maxBuffer: MAX_OUTPUT_BYTES,
        encoding: 'utf8',
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ exitCode: 0, stdout, stderr });
          return;
        }
        const failure = error as NodeJS.ErrnoException & {
          code?: number | string;
          killed?: boolean;
        };
        if (failure.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
          reject(new StoryCommandError(1, 'story output exceeded the 1 MB limit'));
          return;
        }
        if (failure.killed) {
          reject(
            new StoryCommandError(1, `story did not finish within ${options.timeoutMs / 1000}s`),
          );
          return;
        }
        if (typeof failure.code === 'number') {
          resolve({ exitCode: failure.code, stdout, stderr });
          return;
        }
        reject(error);
      },
    );
  });
}
