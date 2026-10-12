import type { StoryChoice, StoryNode, StoryVariable } from '@worldbookllm/shared';

import type { AssembledStory } from './assemble.js';
import type { ParsedNode } from './compile.js';

/** A parse-tree node with the fields this module reads, all optional. */
interface Node extends ParsedNode {
  readonly parent?: Node | null;
  readonly identifier?: { name: string | null } | null;
  readonly name?: string | null;
  readonly subFlowsByName?: Map<string, Node>;
  readonly variableDeclarations?: Map<string, Node>;
  readonly constants?: Map<string, Node>;
  readonly onceOnly?: boolean;
  readonly startContent?: Node | null;
  readonly choiceOnlyContent?: Node | null;
  readonly condition?: Node | null;
  readonly text?: string;
  readonly target?: { dotSeparatedComponents: string } | null;
  readonly targetContent?: Node | null;
  readonly isTunnel?: boolean;
  readonly isThread?: boolean;
  readonly isEnd?: boolean;
  readonly isDone?: boolean;
  /** A choice's runtime choice point, whose path the runtime reports as the choice's source. */
  readonly runtimeChoice?: { path?: { toString(): string } | null } | null;
  readonly isFunctionCall?: boolean;
  readonly variableName?: string;
  readonly varIdentifier?: { name: string | null } | null;
}

export interface StoryStructure {
  start: string | null;
  nodes: StoryNode[];
  variables: StoryVariable[];
  /** Each choice's runtime source path, which the runtime reports when it offers it. */
  choiceSources: Map<StoryChoice, string>;
}

const FLOWS = new Set(['Knot', 'Stitch', 'Function']);

function nameOf(node: Node): string {
  return node.identifier?.name ?? node.name ?? '';
}

/** The knot or `knot.stitch` a parse-tree node sits in, or null at the top. */
function flowPathOf(node: Node | null | undefined): string | null {
  for (let current = node; current; current = current.parent) {
    if (current.typeName === 'Stitch') {
      const knot = current.parent;
      return knot && FLOWS.has(knot.typeName)
        ? `${nameOf(knot)}.${nameOf(current)}`
        : nameOf(current);
    }
    if (current.typeName === 'Knot' || current.typeName === 'Function') return nameOf(current);
  }
  return null;
}

function textOf(node: Node | null | undefined): string {
  if (!node) return '';
  if (node.typeName === 'Text') return node.text ?? '';
  return (node.content ?? []).map((child) => textOf(child as Node)).join('');
}

function words(text: string): number {
  return text.split(/\s+/u).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

// `* {a} {b} (label) [text]`: the conditions are the braces after the bullets.
const CHOICE_LINE = /^\s*(?:[*+]\s*)+(?:\(\s*\w+\s*\)\s*)?((?:\{[^}]*\}\s*)*)/u;

function conditionOf(line: string | null): string | null {
  const match = line === null ? null : CHOICE_LINE.exec(line);
  const braces = match?.[1]?.match(/\{[^}]*\}/gu) ?? [];
  const parts = braces.map((brace) => brace.slice(1, -1).trim()).filter((part) => part !== '');
  return parts.length === 0
    ? null
    : parts.length === 1
      ? parts[0]!
      : parts.map((part) => `(${part})`).join(' and ');
}

interface Draft {
  node: StoryNode;
  edges: Set<string>;
}

/**
 * The compiled story's structure: each knot and stitch with its choices,
 * diverts, the variables it reads and writes, and whether a path from the
 * start leads there.
 */
export function storyStructure(parsed: ParsedNode, story: AssembledStory): StoryStructure {
  const root = parsed as Node;
  const chapters = new Map(story.chapters.map((chapter) => [chapter.knot, chapter]));
  const place = (node: Node) => {
    const meta = node.debugMetadata;
    return meta?.fileName ? story.locate(meta.fileName, meta.startLineNumber) : null;
  };
  const drafts = new Map<string, Draft>();
  const tops: string[] = [];
  const choiceSources = new Map<StoryChoice, string>();

  const draftFor = (flow: Node, knot: Node | null): Draft => {
    const own = nameOf(flow);
    const name = knot === null ? own : `${nameOf(knot)}.${own}`;
    const chapter = chapters.get(knot === null ? own : nameOf(knot));
    const at = place(flow);
    const draft: Draft = {
      node: {
        name,
        kind:
          knot !== null
            ? 'stitch'
            : flow.typeName === 'Function'
              ? 'function'
              : chapter !== undefined
                ? 'chapter'
                : 'knot',
        chapterId: chapter?.id ?? null,
        title: knot === null ? (chapter?.title ?? own) : own,
        path: at?.path ?? chapter?.path ?? null,
        line: at?.line ?? null,
        choices: [],
        diverts: [],
        ends: false,
        reads: [],
        writes: [],
        words: 0,
        reachable: false,
      },
      edges: new Set(),
    };
    drafts.set(name, draft);
    return draft;
  };

  const lineOf = (node: Node) => place(node)?.line ?? null;
  const targetOf = (divert: Node): string | null => {
    if (divert.isEnd) return 'END';
    if (divert.isDone) return 'DONE';
    return flowPathOf(divert.targetContent) ?? divert.target?.dotSeparatedComponents ?? null;
  };

  /** Reads one flow's own content: everything but the stitches inside it. */
  const readFlow = (flow: Node, draft: Draft | null) => {
    const reads = new Set<string>();
    const writes = new Set<string>();
    const choices: Array<{ record: StoryChoice; writes: Set<string> }> = [];
    const visit = (node: Node, choice: { record: StoryChoice; writes: Set<string> } | null) => {
      switch (node.typeName) {
        case 'Text':
          if (draft) draft.node.words += words(node.text ?? '');
          return;
        case 'ref':
          if (node.name) reads.add(node.name);
          break;
        case 'variable assignment':
          if (node.variableName) {
            writes.add(node.variableName);
            choice?.writes.add(node.variableName);
          }
          break;
        case 'IncDecExpression': {
          const name = node.varIdentifier?.name;
          if (name) {
            reads.add(name);
            writes.add(name);
            choice?.writes.add(name);
          }
          break;
        }
        case 'Divert': {
          if (node.isFunctionCall) break;
          const target = targetOf(node);
          if (target === 'END') {
            if (draft) draft.node.ends = true;
            if (choice && choice.record.target === null) choice.record.target = 'END';
            return;
          }
          if (target === null || target === 'DONE') {
            if (choice && choice.record.target === null && target === 'DONE')
              choice.record.target = 'DONE';
            return;
          }
          if (draft === null) {
            tops.push(target);
            return;
          }
          draft.edges.add(target);
          if (choice && choice.record.target === null && !node.isTunnel && !node.isThread) {
            choice.record.target = target;
            return;
          }
          draft.node.diverts.push({
            target,
            kind: node.isTunnel ? 'tunnel' : node.isThread ? 'thread' : 'divert',
            line: lineOf(node),
          });
          return;
        }
        default:
          if (FLOWS.has(node.typeName)) return;
      }
      visitList(node.content ?? [], choice);
    };
    // Lines after a choice, up to the next choice or gather, belong to it.
    const visitList = (
      list: readonly ParsedNode[],
      outer: { record: StoryChoice; writes: Set<string> } | null,
    ) => {
      let current = outer;
      for (const child of list as Node[]) {
        if (child.typeName === 'Choice') {
          const at = place(child);
          const record: StoryChoice = {
            text: (textOf(child.startContent) + textOf(child.choiceOnlyContent)).trim(),
            once: child.onceOnly !== false,
            condition: conditionOf(at?.line ? story.lineText(at.path, at.line) : null),
            target: null,
            writes: [],
            line: at?.line ?? null,
          };
          const source = runtimePath(child);
          if (source !== null) choiceSources.set(record, source);
          current = { record, writes: new Set<string>() };
          choices.push(current);
          visit(child, current);
          if (draft) draft.node.choices.push(record);
          continue;
        }
        if (child.typeName === 'Gather') {
          current = outer;
          visit(child, null);
          continue;
        }
        visit(child, current);
      }
    };
    visitList(flow.content ?? [], null);
    for (const choice of choices) choice.record.writes = [...choice.writes];
    if (draft) {
      draft.node.reads = [...reads];
      draft.node.writes = [...writes];
    }
  };

  readFlow(root, null);
  for (const knot of root.subFlowsByName?.values() ?? []) {
    const draft = draftFor(knot, null);
    readFlow(knot, draft);
    const stitches = [...(knot.subFlowsByName?.values() ?? [])];
    // A knot with stitches flows into the first one when it has nothing of its own to run.
    if (stitches[0] !== undefined) draft.edges.add(`${nameOf(knot)}.${nameOf(stitches[0])}`);
    for (const stitch of stitches) readFlow(stitch, draftFor(stitch, knot));
  }

  const declared = new Set<string>([
    ...(root.variableDeclarations?.keys() ?? []),
    ...(root.constants?.keys() ?? []),
  ]);
  for (const { node } of drafts.values()) {
    node.reads = node.reads.filter((name) => declared.has(name));
  }

  const start = tops[0] ?? story.defaultStart;
  const queue = [...new Set(tops.length > 0 ? tops : start === null ? [] : [start])];
  for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
    const draft = drafts.get(name);
    if (draft === undefined || draft.node.reachable) continue;
    draft.node.reachable = true;
    for (const target of draft.edges) queue.push(target);
    for (const choice of draft.node.choices) if (choice.target !== null) queue.push(choice.target);
  }
  // A function is reached by being called, which this reading does not follow.
  for (const { node } of drafts.values()) if (node.kind === 'function') node.reachable = true;

  return {
    start,
    nodes: [...drafts.values()].map((draft) => draft.node),
    variables: variablesOf(root, story),
    choiceSources,
  };
}

/** A parsed choice's runtime path, or null when it was not compiled. */
function runtimePath(choice: Node): string | null {
  try {
    return choice.runtimeChoice?.path?.toString() ?? null;
  } catch {
    return null;
  }
}

const DECLARATION = /^\s*(?:VAR|CONST|LIST)\s+[A-Za-z_]\w*\s*=\s*(.*?)\s*(?:\/\/.*)?$/u;

function variablesOf(root: Node, story: AssembledStory): StoryVariable[] {
  const entries: Array<[string, Node, StoryVariable['kind']]> = [
    ...[...(root.variableDeclarations?.entries() ?? [])].map(
      ([name, node]) =>
        [name, node, node.typeName === 'LIST' ? 'list' : 'var'] as [
          string,
          Node,
          StoryVariable['kind'],
        ],
    ),
    ...[...(root.constants?.entries() ?? [])].map(
      ([name, node]) => [name, node, 'const'] as [string, Node, StoryVariable['kind']],
    ),
  ];
  return entries.map(([name, node, kind]) => {
    const meta = node.debugMetadata;
    const at = meta?.fileName ? story.locate(meta.fileName, meta.startLineNumber) : null;
    const text = at?.line ? story.lineText(at.path, at.line) : null;
    return {
      name,
      kind,
      initial: (text === null ? null : DECLARATION.exec(text)?.[1]) ?? '',
      path: at?.path ?? null,
      line: at?.line ?? null,
    };
  });
}
