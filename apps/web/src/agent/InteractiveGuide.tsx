import type { BookBranches, BookFile } from '@worldbookllm/shared';
import { useState } from 'react';

import { useApi } from '../api/useApi.js';
import { useBook } from '../books/book-context.js';
import { useLoad } from '../books/useLoad.js';

const BRANCH_MAP = 'adaptations/interactive/branch-map.md';

function hiddenKey(slug: string): string {
  return `worldbookllm.interactiveGuide.${slug}.hidden`;
}

function readHidden(slug: string): boolean {
  try {
    return localStorage.getItem(hiddenKey(slug)) === 'true';
  } catch {
    return false;
  }
}

function writeHidden(slug: string, hidden: boolean): void {
  try {
    if (hidden) localStorage.setItem(hiddenKey(slug), 'true');
    else localStorage.removeItem(hiddenKey(slug));
  } catch {
    // Hiding the guide is a convenience; private windows may refuse it.
  }
}

interface Step {
  key: string;
  title: string;
  detail: string;
  done: boolean;
  action: string;
  prompt: string;
}

/** How choices carry state in worldbookllm (ADR 0028), which story-skills' skills do not describe. */
const STATE_SYNTAX = [
  'In this app a choice can also carry state in its frontmatter entry:',
  '`sets: [found_coat, not lamp_lit]` sets flags true (or false with "not") when the reader picks it,',
  'and `requires: [found_coat, not met_venn, chapter-03]` offers it only when every entry holds,',
  'where a chapter id means the reader has read that chapter.',
  'Flag names use letters, digits, and underscores, and cannot be a chapter knot name such as chapter_03.',
].join(' ');

/** The guide's steps, worked out from what the book holds now. */
function stepsFor(files: readonly BookFile[], branches: BookBranches | null): Step[] {
  const hasMap = files.some((file) => file.path === BRANCH_MAP);
  const chapters = branches?.chapters ?? [];
  const ids = new Set(chapters.map((chapter) => chapter.id));
  const unreachable = chapters.filter((chapter) => !chapter.reachable);
  const broken = chapters.filter(
    (chapter) =>
      chapter.problems.length > 0 || chapter.choices.some((choice) => !ids.has(choice.to)),
  );
  const branching = branches?.branching === true;

  return [
    {
      key: 'map',
      title: 'Plan the branches',
      detail: hasMap
        ? `${BRANCH_MAP} holds the plan.`
        : 'Decide the structure, the decision points, where branches rejoin, and the endings.',
      done: hasMap,
      action: 'Plan the branches',
      prompt: [
        'Plan this book as an interactive story with the interactive-fiction skill',
        '(and the adaptation skill, if these chapters began as a linear book).',
        'Ask me with ask_user which structure to use (branch and bottleneck, gauntlet, time cave, sorting hat, or hub),',
        'then find the decision points in the chapters and propose the choices, where each leads, the rejoins, and the endings.',
        `Write the plan to ${BRANCH_MAP} with a mermaid flowchart and a table of the state each choice sets and reads.`,
        'Do not change any chapter yet.',
      ].join(' '),
    },
    {
      key: 'choices',
      title: 'Add the choices',
      detail: branching
        ? `${chapters.reduce((sum, chapter) => sum + chapter.choices.length, 0)} choices across ${chapters.length} chapters.`
        : 'Give each chapter at a decision point its choices, as the plan says.',
      done: branching,
      action: 'Add the choices',
      prompt: [
        `Add the choices in ${BRANCH_MAP} to the chapters' frontmatter as \`choices\` entries of text and to,`,
        'adding a chapter with story add chapter where the plan needs a new one.',
        'Remember that once any chapter has choices, every chapter without them is an ending, so give each chapter that should run on a choice too.',
        'Then run story links and fix what it reports.',
      ].join(' '),
    },
    {
      key: 'draft',
      title: 'Draft the branches',
      detail: 'Write the chapters each branch adds, and the moments where branches rejoin.',
      done: false,
      action: 'Draft a branch',
      prompt: [
        'Draft the next chapter the branch map adds that has no prose yet, with the interactive-fiction and chapter-writing skills.',
        'It must read right from every chapter whose choices lead to it, so check each one first,',
        'and acknowledge the choice that brought the reader there. Ask me before drafting more than one chapter.',
      ].join(' '),
    },
    {
      key: 'state',
      title: 'Remember choices',
      detail:
        (branches?.flags.length ?? 0) > 0
          ? `Flags in use: ${branches!.flags.join(', ')}.`
          : 'Let choices set flags that later choices or chapters depend on.',
      done: (branches?.flags.length ?? 0) > 0,
      action: 'Add state',
      prompt: [
        `Go through the State table in ${BRANCH_MAP} and add it to the choices.`,
        STATE_SYNTAX,
        'Ask me before adding a flag the plan does not name.',
      ].join(' '),
    },
    {
      key: 'paths',
      title: 'Check every path',
      detail:
        unreachable.length + broken.length === 0
          ? 'No unreachable chapters or broken choices.'
          : `${unreachable.length} unreachable ${unreachable.length === 1 ? 'chapter' : 'chapters'}, ${broken.length} with broken choices.`,
      done: false,
      action: 'Check the paths',
      prompt: [
        'Run story check, then fix the branching findings: unreachable-chapter, choices to missing chapters,',
        'and state-differs-by-path (a fact or object state that differs depending on the path that led to a chapter).',
        'Make sure every path reaches an ending, ask me before changing any prose, and tell me what you could not fix.',
      ].join(' '),
    },
  ];
}

interface InteractiveGuideProps {
  /** Puts text in the agent message draft. */
  onAsk: (text: string) => void;
}

/**
 * A guide for building an interactive book with the agent: plan the branch
 * map, add the choices, draft the branches, add state, and check every
 * path. Each step puts a request in the composer for the writer to edit and
 * send, and each turn can be undone.
 */
export function InteractiveGuide({ onAsk }: InteractiveGuideProps) {
  const api = useApi();
  const { slug, tree } = useBook();
  const [hidden, setHidden] = useState(() => readHidden(slug));
  const interactive = tree.book.interactive === true;
  const branches = useLoad(
    (signal) => (interactive ? api.getBranches(slug, signal) : Promise.resolve(null)),
    `${slug}:${interactive}:${tree.files.map((file) => file.hash).join()}`,
  );
  if (!interactive) return null;

  if (hidden) {
    return (
      <p className="bible-guide-hidden">
        <button
          type="button"
          className="text-button"
          onClick={() => {
            writeHidden(slug, false);
            setHidden(false);
          }}
        >
          Show the Interactive story guide
        </button>
      </p>
    );
  }

  const steps = stepsFor(tree.files, branches.status === 'ready' ? branches.data : null);
  const next = steps.find((step) => !step.done);
  return (
    <section className="bible-guide" aria-labelledby="interactive-guide-heading">
      <p className="coordinate-label">Interactive book</p>
      <h3 id="interactive-guide-heading">Interactive story</h3>
      <p>
        Build the branches with the agent: plan them, add the choices, draft what each branch adds,
        remember choices with flags, and check every path. Each step puts a request in the message
        box for you to edit and send, and each turn can be undone.
      </p>
      <ol className="bible-guide-steps">
        {steps.map((step) => (
          <li key={step.key} data-done={step.done ? '' : undefined}>
            <div>
              <strong>
                {step.title}
                {step.done ? <span className="coordinate-label"> · done</span> : null}
              </strong>
              <span>{step.detail}</span>
            </div>
            <button
              type="button"
              className={step === next ? 'button-primary' : 'button-secondary'}
              onClick={() => onAsk(step.prompt)}
            >
              {step.action}
            </button>
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="text-button"
        onClick={() => {
          writeHidden(slug, true);
          setHidden(true);
        }}
      >
        Hide this guide
      </button>
    </section>
  );
}
