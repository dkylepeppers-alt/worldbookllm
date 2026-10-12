import type { BookFile, InteractiveStory } from '@worldbookllm/shared';
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

/** How an interactive book's ink is laid out (ADR 0030), which story-skills' skills do not describe. */
const INK_LAYOUT = [
  "This book is written in ink: each chapter's ink is under its ## Chapter Text heading, and its knot name is its id with - as _ (chapter-03 is chapter_03).",
  'Global VAR, CONST, and LIST declarations go in ink/variables.md.',
].join(' ');

/** The guide's steps, worked out from what the book holds now. */
function stepsFor(files: readonly BookFile[], story: InteractiveStory | null): Step[] {
  const hasMap = files.some((file) => file.path === BRANCH_MAP);
  const nodes = story?.nodes ?? [];
  const choices = nodes.reduce((sum, node) => sum + node.choices.length, 0);
  const variables = story?.variables ?? [];
  const errors = story?.diagnostics.filter((entry) => entry.severity === 'error').length ?? 0;
  const warnings = story?.diagnostics.filter((entry) => entry.severity === 'warning').length ?? 0;

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
      detail:
        choices > 0
          ? `${choices} ${choices === 1 ? 'choice' : 'choices'} across ${story?.chapters.length ?? 0} chapters.`
          : 'Give each chapter at a decision point its choices, as the plan says.',
      done: choices > 0,
      action: 'Add the choices',
      prompt: [
        `Add the choices in ${BRANCH_MAP} to the chapters as ink choices.`,
        INK_LAYOUT,
        'Use choices inside a scene (with a gather to rejoin) where the plan has a small decision, and choices that divert to another chapter where it branches.',
        'Make sure every chapter ends in choices, a divert, or -> END. Tell me what you changed.',
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
        INK_LAYOUT,
        'It must read right from every chapter whose choices lead to it, so check each one first,',
        'and acknowledge the choice that brought the reader there with conditional text where it helps. Ask me before drafting more than one chapter.',
      ].join(' '),
    },
    {
      key: 'state',
      title: 'Remember choices',
      detail:
        variables.length > 0
          ? `Variables: ${variables.map((variable) => variable.name).join(', ')}.`
          : 'Let choices set variables that later choices and text depend on.',
      done: variables.length > 0,
      action: 'Add state',
      prompt: [
        `Go through the State table in ${BRANCH_MAP} and add it to the ink.`,
        INK_LAYOUT,
        'Declare each variable once, set it with ~ lines where a choice changes it, test it in choice conditions ({trust > 1}),',
        'and vary the prose with conditional text ({met_venn: She nods.|She looks you over.}). Ask me before adding a variable the plan does not name.',
      ].join(' '),
    },
    {
      key: 'paths',
      title: 'Check every path',
      detail:
        story === null
          ? 'Compile the story and fix what it reports.'
          : errors > 0
            ? `${errors} compile ${errors === 1 ? 'error' : 'errors'} to fix.`
            : warnings > 0
              ? `${warnings} ${warnings === 1 ? 'note' : 'notes'} on Health.`
              : 'The ink compiles, and nothing stands out.',
      done: false,
      action: 'Check the paths',
      prompt: [
        'Check the interactive story: run ink_check, then fix what it reports (compile errors, knots nothing leads to, chapters that run out of story, variables nothing reads).',
        'Use ink_play to read each ending path and the branches that depend on variables, and look for choices whose conditions can never hold.',
        'Ask me before changing any prose, and tell me what you could not fix.',
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
  const story = useLoad(
    (signal) => (interactive ? api.getInteractiveStory(slug, signal) : Promise.resolve(null)),
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

  const steps = stepsFor(tree.files, story.status === 'ready' ? story.data : null);
  const next = steps.find((step) => !step.done);
  return (
    <section className="bible-guide" aria-labelledby="interactive-guide-heading">
      <p className="coordinate-label">Interactive book</p>
      <h3 id="interactive-guide-heading">Interactive story</h3>
      <p>
        Build the branches with the agent: plan them, add the choices in ink, draft what each branch
        adds, remember choices with variables, and check every path. Each step puts a request in the
        message box for you to edit and send, and each turn can be undone.
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
