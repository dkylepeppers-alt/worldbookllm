import type { InkDiagnostic } from '@worldbookllm/shared';
import { Story } from 'inkjs';

import { parseFrontmatter } from '../story/book-index.js';
import { explorePaths } from '../story/interactive/explore.js';
import { describeDiagnostic, storyFindings } from '../story/interactive/findings.js';
import { feedsInk, readInkStory, type InkReading } from '../story/interactive/read.js';
import type { AgentWorkspace } from './workspace.js';

/**
 * The agent's view of an interactive book's ink (ADR 0030), read through its
 * workspace, so in review mode it sees the staged copy it is changing.
 */

/** Whether the workspace's book is interactive: story.md says `interactive: true`. */
export function isInteractiveWorkspace(workspace: AgentWorkspace): boolean {
  try {
    return (
      parseFrontmatter(workspace.readFile('story.md').content).frontmatter?.interactive === true
    );
  } catch {
    return false;
  }
}

/** The book's ink as the workspace has it now. */
function readWorkspaceInk(workspace: AgentWorkspace): InkReading {
  const files = workspace
    .listFiles()
    .filter((file) => feedsInk(file.path))
    .map((file) => ({
      path: file.path,
      title: file.title,
      text: workspace.readFile(file.path).content,
    }));
  return readInkStory(files, 'Untitled');
}

function diagnosticsOf(reading: InkReading, workspace: AgentWorkspace): InkDiagnostic[] {
  let ifid: unknown;
  try {
    ifid = parseFrontmatter(workspace.readFile('story.md').content).frontmatter?.ifid;
  } catch {
    ifid = undefined;
  }
  return [...reading.compiled.diagnostics, ...storyFindings(reading.structure, ifid)];
}

const MAX_LINES = 60;

function limited(lines: readonly string[]): string[] {
  return lines.length <= MAX_LINES
    ? [...lines]
    : [...lines.slice(0, MAX_LINES), `… and ${lines.length - MAX_LINES} more`];
}

/**
 * What the compiler and the story's structure say, and the structure in
 * brief: each knot and stitch with its choices and where they lead.
 */
export function inkReport(workspace: AgentWorkspace, path?: string): string {
  const reading = readWorkspaceInk(workspace);
  const diagnostics = diagnosticsOf(reading, workspace).filter(
    (entry) => path === undefined || entry.path === path,
  );
  const lines = [
    reading.structure === null ? 'The ink does not compile.' : 'The ink compiles.',
    diagnostics.length === 0
      ? path === undefined
        ? 'No problems found.'
        : `No problems in ${path}.`
      : `${diagnostics.length} ${diagnostics.length === 1 ? 'problem' : 'problems'}:`,
    ...limited(diagnostics.map((entry) => `- ${entry.severity}: ${describeDiagnostic(entry)}`)),
  ];
  const structure = reading.structure;
  if (structure !== null && path === undefined) {
    lines.push('', `Start: ${structure.start ?? 'none'}`, 'Knots:');
    lines.push(
      ...limited(
        structure.nodes
          .filter((node) => node.kind !== 'function')
          .map((node) => {
            const out = [
              ...node.choices.map(
                (choice) =>
                  `[${choice.text}]${choice.condition === null ? '' : ` if ${choice.condition}`} -> ${choice.target ?? '(flows on)'}`,
              ),
              ...node.diverts.map((divert) => `${divert.kind} -> ${divert.target}`),
              ...(node.ends ? ['-> END'] : []),
            ];
            return `- ${node.name} (${node.path ?? 'no file'}${node.reachable ? '' : ', not reachable'}): ${out.join('; ') || 'runs out'}`;
          }),
      ),
    );
    if (structure.variables.length > 0) {
      lines.push(
        'Variables:',
        ...structure.variables.map(
          (variable) => `- ${variable.kind} ${variable.name} = ${variable.initial}`,
        ),
      );
    }
  }
  return lines.join('\n');
}

/** After the agent writes a file the ink reads: that file's problems, if any. */
export function inkNoteAfterWrite(workspace: AgentWorkspace, path: string): string {
  if (!feedsInk(path) || !isInteractiveWorkspace(workspace)) return '';
  const reading = readWorkspaceInk(workspace);
  const mine = diagnosticsOf(reading, workspace).filter(
    (entry) => entry.path === path && entry.severity === 'error',
  );
  if (mine.length === 0) {
    return reading.structure === null
      ? ' The ink does not compile yet because of other files; run ink_check.'
      : ' The ink compiles.';
  }
  return `\nThe ink in ${path} does not compile:\n${limited(mine.map((entry) => `- ${describeDiagnostic(entry)}`)).join('\n')}`;
}

/**
 * Plays every path of the story (ADR 0032) and reports what reading the
 * source cannot show: runtime errors with the choices that reach them,
 * endings, and the knots and choices no path reaches.
 */
export function inkPaths(workspace: AgentWorkspace): string {
  const reading = readWorkspaceInk(workspace);
  if (reading.compiled.json === null || reading.structure === null) {
    throw new Error('The ink does not compile, so its paths cannot be played. Run ink_check.');
  }
  const report = explorePaths(reading.compiled.json, reading.structure.nodes);
  const place = (path: string | null, line: number | null) =>
    path === null ? 'no file' : line === null ? path : `${path}:${line}`;
  const lines = [
    report.complete
      ? `Played every path: ${report.explored} distinct states.`
      : `Played ${report.explored} distinct states and stopped; the story has more, so this is partial.`,
    report.endings === 0
      ? 'No path reaches an ending.'
      : `${report.endings} ${report.endings === 1 ? 'path reaches' : 'paths reach'} an ending, in ${report.shortest} to ${report.longest} choices.`,
  ];
  if (report.errors.length > 0) {
    lines.push(
      'Runtime errors (choices are indexes for ink_play, seed 1):',
      ...limited(
        report.errors.map((error) => `- ${error.message} — choices [${error.path.join(', ')}]`),
      ),
    );
  }
  if (report.unreached.length > 0) {
    lines.push(
      'No path reaches:',
      ...limited(report.unreached.map((node) => `- ${node.node} (${place(node.path, node.line)})`)),
    );
  }
  if (report.neverOffered.length > 0) {
    lines.push(
      'Choices no path offers:',
      ...limited(
        report.neverOffered.map(
          (choice) => `- [${choice.text}] in ${choice.node} (${place(choice.path, choice.line)})`,
        ),
      ),
    );
  }
  return lines.join('\n');
}

export interface InkPlayInput {
  /** A knot or `knot.stitch` to start from; the story's start when left out. */
  from?: string | undefined;
  /** Choice indexes to pick in turn, from 0. */
  choices: number[];
  /** Variables to set before starting. */
  set: Record<string, string | number | boolean>;
  seed: number;
}

/**
 * Plays the story with inkle's runtime: the text of each passage, the
 * choices offered and the one picked, then where it stopped and every
 * variable's value, so the agent can check a path reads as it meant.
 */
export function inkPlay(workspace: AgentWorkspace, input: InkPlayInput): string {
  const reading = readWorkspaceInk(workspace);
  if (reading.compiled.json === null) {
    const errors = reading.compiled.diagnostics
      .filter((entry) => entry.severity === 'error')
      .map((entry) => `- ${describeDiagnostic(entry)}`);
    throw new Error(
      `The ink does not compile, so it cannot be played:\n${limited(errors).join('\n')}`,
    );
  }
  const story = new Story(reading.compiled.json);
  story.state.storySeed = input.seed;
  for (const [name, value] of Object.entries(input.set)) story.variablesState.$(name, value);
  if (input.from !== undefined) story.ChoosePathString(input.from);
  const lines: string[] = [];
  const run = () => {
    while (story.canContinue) {
      const text = story.Continue()?.trim() ?? '';
      const tags: string[] = story.currentTags ?? [];
      const chapter = tags
        .map((tag: string) => /^chapter\s*:\s*(.*)$/u.exec(tag)?.[1])
        .find(Boolean);
      if (chapter) lines.push(`## ${chapter}`);
      if (text !== '') lines.push(text);
    }
  };
  run();
  for (const index of input.choices) {
    const offered: string[] = story.currentChoices.map((choice: { text: string }) => choice.text);
    const picked = offered[index];
    if (picked === undefined) {
      lines.push(
        `(Choice ${index} is not offered here. Offered: ${offered.map((text: string, at: number) => `${at}: ${text}`).join('; ') || 'none'})`,
      );
      break;
    }
    lines.push(`> ${picked}`);
    story.ChooseChoiceIndex(index);
    run();
  }
  const offered: string[] = story.currentChoices.map(
    (choice: { text: string }, at: number) => `${at}: ${choice.text}`,
  );
  const variables = reading.structure?.variables ?? [];
  return [
    ...limited(lines),
    '',
    offered.length === 0 ? 'The story ends here.' : `Choices now: ${offered.join('; ')}`,
    ...(variables.length === 0
      ? []
      : [
          `Variables: ${variables
            .map(
              (variable) => `${variable.name} = ${String(story.variablesState.$(variable.name))}`,
            )
            .join(', ')}`,
        ]),
  ].join('\n');
}
