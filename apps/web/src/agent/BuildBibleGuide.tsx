import type { BookFile } from '@worldbookllm/shared';
import { useState } from 'react';

import { useBook } from '../books/book-context.js';

/** Chapters the agent reverse-outlines per turn, so each turn stays in its context and undoes alone. */
const BATCH = 5;

const BIBLE_KINDS = new Set(['character', 'location', 'faction', 'artifact', 'system']);
const THREAD_KINDS = new Set(['question', 'promise', 'clue']);

function hiddenKey(slug: string): string {
  return `worldbookllm.bibleGuide.${slug}.hidden`;
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

function chapterNumber(file: BookFile): number | null {
  const number = /^chapter-(\d+)$/u.exec(file.entityId ?? '')?.[1];
  return file.kind === 'chapter' && number !== undefined ? Number(number) : null;
}

interface Step {
  key: string;
  title: string;
  detail: string;
  done: boolean;
  /** The message the step puts in the composer, or null when there is nothing to send. */
  prompt: string | null;
  action: string;
}

/** The guide's steps, worked out from what the book holds now. */
function stepsFor(files: readonly BookFile[]): { steps: Step[]; needed: boolean } {
  const reports = files
    .filter((file) => /^research\/import-report(?:-\d+)?\.md$/u.test(file.path))
    .map((file) => file.path);
  const chapters = files
    .flatMap((file) => {
      const number = chapterNumber(file);
      return number === null ? [] : [number];
    })
    .sort((left, right) => left - right);
  const scened = new Set(
    files.flatMap((file) => {
      const chapter = /^scenes\/chapter-(\d+)-scene-\d+\.md$/u.exec(file.path)?.[1];
      return chapter === undefined ? [] : [Number(chapter)];
    }),
  );
  const hasBible = files.some((file) => file.entityId !== null && BIBLE_KINDS.has(file.kind));
  const hasThreads = files.some((file) => file.entityId !== null && THREAD_KINDS.has(file.kind));
  const unscened = chapters.filter((number) => !scened.has(number));
  const batch = unscened.slice(0, BATCH);
  const range =
    batch.length === 0
      ? ''
      : batch.length === 1
        ? `chapter ${batch[0]}`
        : `chapters ${batch[0]}–${batch.at(-1)}`;

  const steps: Step[] = [
    {
      key: 'cast',
      title: 'Cast and world',
      detail:
        reports.length > 0
          ? `Turn the names in ${reports.join(', ')} into characters, places, and factions.`
          : 'Find the recurring names in the chapters and turn them into bible entries.',
      done: hasBible,
      action: 'Build the cast',
      prompt: [
        'Build the cast and world from the chapters.',
        reports.length > 0
          ? `Read ${reports.join(' and ')} for the names the manuscript repeats.`
          : 'Find the names the chapters repeat.',
        'Ask me about them with ask_user, a few at a time, with choices for what each one is: character, location, faction, artifact, or not one.',
        'When I am unsure about a name, show me where it appears with story mentions.',
        'Create the ones I approve with story add, then run story check.',
        'Follow the character-management and worldbuilding skills, and do not change the prose.',
      ].join(' '),
    },
    {
      key: 'outline',
      title: 'Chapter casts and scenes',
      detail:
        chapters.length === 0
          ? 'The book has no chapters yet.'
          : `${chapters.length - unscened.length} of ${chapters.length} chapters have scene records. The agent works through ${BATCH} chapters a turn.`,
      done: chapters.length > 0 && unscened.length === 0,
      action: range === '' ? 'Outline chapters' : `Outline ${range}`,
      prompt:
        range === ''
          ? null
          : [
              `Reverse-outline ${range}.`,
              "For each, fill pov, characters, and locations in the chapter's frontmatter with ids from the bible, and add its scene records with story add scene.",
              'Do not change the prose, and ask me before adding anyone to the bible.',
              "Follow the revision-continuity skill's reverse outline, then run story check.",
            ].join(' '),
    },
    {
      key: 'threads',
      title: 'Threads and continuity',
      detail: 'Record open questions, promises, and clues, and bring continuity state up to date.',
      done: hasThreads,
      action: 'Record threads',
      prompt: [
        'From the chapters so far, record the open questions, promises, and clues with story add,',
        'and bring continuity/state.md up to the last chapter.',
        'Ask me before recording anything you are unsure of, then run story check.',
      ].join(' '),
    },
    {
      key: 'check',
      title: 'Check the book',
      detail: 'Run every check and fix what is left.',
      done: false,
      action: 'Check and fix',
      prompt:
        'Run story check and fix what is left. Ask me before changing any prose, and tell me what you could not fix.',
    },
  ];
  // Offered to books with chapters and no bible yet, and to every imported book.
  return { steps, needed: chapters.length > 0 && (reports.length > 0 || !hasBible) };
}

interface BuildBibleGuideProps {
  /** Puts text in the agent message draft. */
  onAsk: (text: string) => void;
}

/**
 * A guide for building the bible from chapters that came in without one,
 * as an import does (ADR 0026). Each step puts a prompt in the composer for
 * the writer to read, edit, and send; steps tick off as the book gains
 * entries, scene records, and threads.
 */
export function BuildBibleGuide({ onAsk }: BuildBibleGuideProps) {
  const { slug, tree } = useBook();
  const [hidden, setHidden] = useState(() => readHidden(slug));
  if (tree.book.kind !== 'book') return null;
  const { steps, needed } = stepsFor(tree.files);
  if (!needed) return null;

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
          Show the Build the bible guide
        </button>
      </p>
    );
  }

  const next = steps.find((step) => !step.done);
  return (
    <section className="bible-guide" aria-labelledby="bible-guide-heading">
      <p className="coordinate-label">Imported chapters</p>
      <h3 id="bible-guide-heading">Build the bible</h3>
      <p>
        Give the agent the bible the chapters need: cast and places, then each chapter's cast and
        scenes, then open threads. Each step puts a request in the message box for you to edit and
        send, and each turn can be undone.
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
            {step.prompt === null ? null : (
              <button
                type="button"
                className={step === next ? 'button-primary' : 'button-secondary'}
                onClick={() => onAsk(step.prompt!)}
              >
                {step.action}
              </button>
            )}
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
