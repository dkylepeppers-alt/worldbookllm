import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { ToolDefinition } from '@worldbookllm/providers';
import { bookFilePathSchema, sha256Schema, storyOptionsSchema } from '@worldbookllm/shared';
import { z } from 'zod';

import type { SkillService } from '../services/skills.js';
import { confine } from '../story/book-paths.js';
import { isStoryCommand, type StoryCommandName } from '../story/story-commands.js';
import type { AgentWorkspace } from './workspace.js';

/**
 * `story` commands the agent may run (ADR 0015 decision 4). Project
 * creation and migration stay with the user, and `compare`/`similarity` are
 * left out because their --ref/--against options name arbitrary paths.
 */
const AGENT_STORY_COMMANDS: ReadonlySet<StoryCommandName> = new Set<StoryCommandName>([
  'validate',
  'reindex',
  'wordcount',
  'links',
  'continuity',
  'knowledge',
  'context',
  'progress',
  'timeline',
  'prose',
  'diagram',
  'names',
  'pacing',
  'clues',
  'voices',
  'series',
  'passes',
  'report',
  'next',
  'doctor',
  'add',
  'rename',
  'remove',
  'move',
  'export',
  'build',
  'synopsis',
]);

const SKILL_FILE_MAX_BYTES = 64 * 1024;

export interface ToolContext {
  workspace: AgentWorkspace;
  /** Skills this turn's agent may use; null allows every installed skill. */
  skills: ReadonlySet<string> | null;
}

export interface ToolOutcome {
  ok: boolean;
  result: string;
}

interface AgentTool<T> {
  definition: ToolDefinition;
  schema: z.ZodType<T>;
  run(args: T, context: ToolContext): Promise<string> | string;
}

function tool<T>(
  name: string,
  description: string,
  parameters: Record<string, unknown>,
  schema: z.ZodType<T>,
  run: (args: T, context: ToolContext) => Promise<string> | string,
): AgentTool<T> {
  return {
    definition: {
      type: 'function',
      function: {
        name,
        description,
        parameters: { type: 'object', additionalProperties: false, ...parameters },
      },
    },
    schema,
    run,
  };
}

const pathParameter = {
  type: 'string',
  description: 'Book-relative path with forward slashes, e.g. characters/sera-voss.md',
};

/**
 * The agent's tools over one book and the installed skills. Every path is
 * confined to the book (or the skill's folder); every write goes through the
 * turn's workspace: the book inside its checkpoint session, or a staged copy
 * in review mode.
 */
export class AgentToolRegistry {
  private readonly tools: ReadonlyMap<string, AgentTool<never>>;

  constructor(
    private readonly skills: SkillService,
    private readonly skillsRoot: string,
  ) {
    const list: Array<AgentTool<never>> = [
      tool(
        'activate_skill',
        'Load the full instructions of an installed skill before doing work it covers.',
        { properties: { name: { type: 'string' } }, required: ['name'] },
        z.object({ name: z.string() }),
        ({ name }, context) => this.activateSkill(name, context),
      ),
      tool(
        'read_skill_file',
        "Read one of a skill's reference files, listed when the skill is activated.",
        {
          properties: { name: { type: 'string' }, path: { type: 'string' } },
          required: ['name', 'path'],
        },
        z.object({ name: z.string(), path: z.string() }),
        ({ name, path }, context) => this.readSkillFile(name, path, context),
      ),
      tool(
        'list_files',
        "List the book's Markdown files with their kind and title, optionally under one folder.",
        { properties: { dir: { type: 'string', description: 'Folder prefix, e.g. characters' } } },
        z.object({ dir: z.string().optional() }),
        ({ dir }, context) => this.listFiles(context.workspace, dir),
      ),
      tool(
        'read_file',
        'Read a book file, frontmatter included, with the hash required to replace it safely.',
        { properties: { path: pathParameter }, required: ['path'] },
        z.object({ path: bookFilePathSchema }),
        ({ path }, context) => JSON.stringify(context.workspace.readFile(path)),
      ),
      tool(
        'search',
        'Full-text search across the book; returns matching files with excerpts.',
        { properties: { query: { type: 'string' } }, required: ['query'] },
        z.object({ query: z.string().min(1).max(500) }),
        ({ query }, context) => this.search(context.workspace, query),
      ),
      tool(
        'write_file',
        'Create or replace a Markdown file in the book. Pass the hash from read_file when replacing, or null when creating. Registries (_index.md) are generated; do not write them.',
        {
          properties: {
            path: pathParameter,
            content: { type: 'string' },
            expectedHash: {
              type: ['string', 'null'],
              pattern: '^[a-f0-9]{64}$',
              description: 'The hash returned by read_file, or null only when creating a new file.',
            },
          },
          required: ['path', 'content', 'expectedHash'],
        },
        z.object({
          path: bookFilePathSchema,
          content: z.string().max(5_000_000),
          expectedHash: sha256Schema.nullable(),
        }),
        async ({ path, content, expectedHash }, context) => {
          await context.workspace.writeFile(path, content, expectedHash);
          return `Wrote ${path}.`;
        },
      ),
      tool(
        'edit_file',
        'Replace one exact passage in a book file. Fails unless `find` occurs exactly once.',
        {
          properties: {
            path: pathParameter,
            find: { type: 'string' },
            replace: { type: 'string' },
          },
          required: ['path', 'find', 'replace'],
        },
        z.object({ path: bookFilePathSchema, find: z.string().min(1), replace: z.string() }),
        ({ path, find, replace }, context) =>
          context.workspace.editFile(path, find, replace).then(() => `Edited ${path}.`),
      ),
      tool(
        'run_story',
        'Run a story CLI command on this book (validate, links, continuity, knowledge, context, names, report, next, add, rename, move, remove, build, …). The server supplies --path and --json.',
        {
          properties: {
            command: { type: 'string', enum: [...AGENT_STORY_COMMANDS] },
            args: { type: 'array', items: { type: 'string' } },
            options: {
              type: 'object',
              description: 'Option names without dashes, e.g. {"role": "protagonist"}',
            },
          },
          required: ['command'],
        },
        z.object({
          command: z.string(),
          args: z.array(z.string().max(2000)).max(20).default([]),
          options: storyOptionsSchema,
        }),
        ({ command, args, options }, context) => this.runStory(context, command, args, options),
      ),
    ] as unknown as Array<AgentTool<never>>;
    this.tools = new Map(list.map((entry) => [entry.definition.function.name, entry]));
  }

  definitions(): ToolDefinition[] {
    return [...this.tools.values()].map((entry) => entry.definition);
  }

  async execute(name: string, rawArguments: string, context: ToolContext): Promise<ToolOutcome> {
    const entry = this.tools.get(name);
    if (!entry) return { ok: false, result: `Unknown tool: ${name}` };
    let parsed: unknown;
    try {
      parsed = rawArguments.trim() === '' ? {} : JSON.parse(rawArguments);
    } catch {
      return { ok: false, result: `The arguments for ${name} were not valid JSON.` };
    }
    const args = entry.schema.safeParse(parsed);
    if (!args.success) {
      return {
        ok: false,
        result: `Invalid arguments for ${name}: ${args.error.issues
          .map((issue) => `${issue.path.join('.') || 'arguments'} ${issue.message}`)
          .join('; ')}`,
      };
    }
    try {
      return { ok: true, result: await entry.run(args.data as never, context) };
    } catch (error) {
      return { ok: false, result: error instanceof Error ? error.message : String(error) };
    }
  }

  private skillByName(name: string, context: ToolContext) {
    const skill = this.skills.list().find((entry) => entry.name === name);
    if (!skill) throw new Error(`No installed skill is named ${name}.`);
    if (context.skills !== null && !context.skills.has(name)) {
      throw new Error(`The skill ${name} is not available to this agent.`);
    }
    return skill;
  }

  private activateSkill(name: string, context: ToolContext): string {
    const skill = this.skills.get(this.skillByName(name, context).id);
    const referencesDir = join(this.skillsRoot, skill.name, 'references');
    let references: string[];
    try {
      references = readdirSync(referencesDir)
        .filter((file) => file.endsWith('.md'))
        .sort()
        .map((file) => `references/${file}`);
    } catch {
      references = [];
    }
    return [
      skill.content,
      references.length > 0
        ? `\n---\nReference files (read with read_skill_file): ${references.join(', ')}`
        : '',
    ].join('');
  }

  private readSkillFile(name: string, path: string, context: ToolContext): string {
    const skill = this.skillByName(name, context);
    const absolute = confine(join(this.skillsRoot, skill.name), path);
    if (!absolute.endsWith('.md')) throw new Error('Only Markdown skill files can be read.');
    if (statSync(absolute).size > SKILL_FILE_MAX_BYTES) {
      throw new Error(`${path} is larger than 64 KB.`);
    }
    return readFileSync(absolute, 'utf8');
  }

  private listFiles(workspace: AgentWorkspace, dir: string | undefined): string {
    const prefix = dir ? `${dir.replace(/\/+$/u, '')}/` : '';
    const files = workspace
      .listFiles()
      .filter((file) => file.kind !== 'registry' && file.path.startsWith(prefix));
    if (files.length === 0) return 'No files.';
    return files.map((file) => `${file.path} — ${file.kind} — ${file.title}`).join('\n');
  }

  private search(workspace: AgentWorkspace, query: string): string {
    const results = workspace.search(query);
    if (results.length === 0) return 'No matches.';
    return results.map((hit) => `${hit.path} (${hit.title}): ${hit.excerpt}`).join('\n');
  }

  private async runStory(
    context: ToolContext,
    command: string,
    args: string[],
    options: Record<string, string | boolean | string[]>,
  ): Promise<string> {
    if (!isStoryCommand(command) || !AGENT_STORY_COMMANDS.has(command)) {
      throw new Error(`story ${command} is not available to the agent.`);
    }
    const result = await context.workspace.runStory(command, args, options);
    const output = result.envelope
      ? JSON.stringify(result.envelope)
      : [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n');
    const rendered = `exit code ${result.exitCode}\n${output}`;
    // 0 is success. 1 is check findings and stays informational. 2 usage,
    // 3 unusable project, and 4 write refused are failures: nothing was applied.
    if (result.exitCode === 2 || result.exitCode === 3 || result.exitCode === 4) {
      throw new Error(rendered);
    }
    return rendered;
  }
}
