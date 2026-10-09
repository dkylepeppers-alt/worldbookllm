import type { BookPlay, PlayKnot } from '@worldbookllm/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Link, useSearchParams } from 'react-router-dom';
import remarkGfm from 'remark-gfm';

import { useApi } from '../api/useApi.js';
import { ErrorState, LoadingState } from '../components/RequestState.js';
import { useBook } from './book-context.js';
import { fileHref } from './book-sections.js';
import { errorMessage, useLoad } from './useLoad.js';

type InkRuntime = typeof import('inkjs');
type InkStory = InstanceType<InkRuntime['Story']>;

/** The lines of one chapter's knot, or of no knot before the first. */
interface Segment {
  knot: PlayKnot | null;
  lines: string[];
}

interface Turn {
  segments: Segment[];
  choices: string[];
  /** The choice that led here, or null at the start. */
  chosen: string | null;
  /** A choice in the address that the story no longer offers. */
  stale: boolean;
}

/**
 * Runs ink until the next choice, grouping its lines by the chapter knot they
 * come from. The story is compiled with every visit counted, so the knots a
 * line entered are the ones whose visit count went up.
 */
function runToChoice(story: InkStory, knots: readonly PlayKnot[]): Segment[] {
  const counts = () =>
    knots.map((entry) => {
      try {
        return story.state.VisitCountAtPathString(entry.knot);
      } catch {
        return 0;
      }
    });
  const segments: Segment[] = [];
  let before = counts();
  while (story.canContinue) {
    const line = story.Continue()?.trim() ?? '';
    const after = counts();
    knots.forEach((entry, index) => {
      if (after[index]! > before[index]!) segments.push({ knot: entry, lines: [] });
    });
    before = after;
    if (segments.length === 0) segments.push({ knot: null, lines: [] });
    if (line !== '') segments.at(-1)!.lines.push(line);
  }
  return segments;
}

/** Plays the story from the start through the choices in `path`. */
function replay(runtime: InkRuntime, play: BookPlay, path: readonly number[]): Turn {
  const story = new runtime.Story(play.story);
  let segments = runToChoice(story, play.knots);
  let chosen: string | null = null;
  for (const index of path) {
    const choice = story.currentChoices[index];
    if (choice === undefined) {
      return {
        segments,
        choices: story.currentChoices.map((entry) => entry.text),
        chosen,
        stale: true,
      };
    }
    chosen = choice.text;
    story.ChooseChoiceIndex(index);
    segments = runToChoice(story, play.knots);
  }
  return {
    segments,
    choices: story.currentChoices.map((entry) => entry.text),
    chosen,
    stale: false,
  };
}

function parsePath(value: string | null): number[] {
  if (value === null || value === '') return [];
  const steps = value.split('.').map(Number);
  return steps.every((step) => Number.isInteger(step) && step >= 0) ? steps : [];
}

/**
 * Write → Play: the book's ink build, run by inkle's own ink runtime one
 * passage at a time with its choices as buttons. The choices made so far are
 * in the address (`?path=1.0`), so the browser's back button steps back and
 * a link reopens the same moment.
 */
export function PlayPage() {
  const api = useApi();
  const { slug, tree } = useBook();
  const story = useLoad(
    (signal) => api.getPlay(slug, signal),
    `${slug}:${tree.files.map((file) => file.hash).join()}`,
  );
  const branchesHref = `/books/${encodeURIComponent(slug)}/write/branches`;

  return (
    <section className="book-panel play-page" aria-labelledby="play-heading">
      <p className="coordinate-label">
        <Link to={branchesHref}>Branches</Link>
      </p>
      <h2 id="play-heading">Play</h2>
      {story.status === 'loading' ? <LoadingState>Building the ink story…</LoadingState> : null}
      {story.status === 'error' ? (
        <>
          <ErrorState
            title="The story cannot be played yet"
            message={story.message}
            onRetry={story.reload}
          />
          <p>
            <Link to={branchesHref}>Fix the choices on the Branches screen</Link>, then come back.
          </p>
        </>
      ) : null}
      {story.status === 'ready' ? <InkPlayer slug={slug} play={story.data} /> : null}
    </section>
  );
}

function InkPlayer({ slug, play }: { slug: string; play: BookPlay }) {
  const [runtime, setRuntime] = useState<InkRuntime | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const pathParam = params.get('path');
  const path = useMemo(() => parsePath(pathParam), [pathParam]);

  // The ink runtime loads with this screen, not with the app.
  useEffect(() => {
    let live = true;
    import('inkjs').then(
      (module) => {
        if (live) setRuntime(module);
      },
      (error: unknown) => {
        if (live) setLoadError(errorMessage(error));
      },
    );
    return () => {
      live = false;
    };
  }, []);

  const turn = useMemo(() => {
    if (runtime === null) return null;
    try {
      return replay(runtime, play, path);
    } catch (error) {
      return errorMessage(error);
    }
  }, [runtime, play, path]);

  if (loadError !== null) {
    return <ErrorState title="The ink runtime could not load" message={loadError} />;
  }
  if (turn === null) return <LoadingState>Starting ink…</LoadingState>;
  if (typeof turn === 'string') {
    return <ErrorState title="The ink story stopped with an error" message={turn} />;
  }

  return (
    <>
      {play.warnings.length > 0 ? (
        <details className="reader-notes">
          <summary>Build notes ({play.warnings.length})</summary>
          <ul>
            {play.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <Passage
        slug={slug}
        turn={turn}
        step={path.join('.')}
        onChoose={(index) => setParams({ path: [...path, index].join('.') })}
        onRestart={() => setParams({})}
      />
      <details className="ink-source">
        <summary>ink source</summary>
        <p className="coordinate-label">
          What <code>story build --format ink</code> writes for this book, compiled here with inkjs.
          Download it from Project → Build to open it in Inky.
        </p>
        <pre className="build-output">{play.source}</pre>
      </details>
    </>
  );
}

function Passage({
  slug,
  turn,
  step,
  onChoose,
  onRestart,
}: {
  slug: string;
  turn: Turn;
  step: string;
  onChoose: (index: number) => void;
  onRestart: () => void;
}) {
  const { tree } = useBook();
  const passage = useRef<HTMLElement>(null);

  // A choice moves focus to the passage it leads to, as following a link would.
  const shown = useRef(step);
  useEffect(() => {
    if (shown.current !== step) {
      const target = passage.current?.querySelector<HTMLElement>('h3') ?? passage.current;
      target?.focus();
    }
    shown.current = step;
  }, [step]);

  const last = [...turn.segments].reverse().find((segment) => segment.knot !== null)?.knot;
  const chapter = tree.files.find(
    (file) => file.kind === 'chapter' && file.entityId === last?.chapterId,
  );

  return (
    <article ref={passage} tabIndex={-1} className="play-passage" aria-label="Story">
      {turn.stale ? (
        <p className="branch-warning">
          The story has changed since these choices were made, so it stops where they no longer fit.
        </p>
      ) : null}
      {turn.chosen === null ? null : <p className="coordinate-label">You chose: {turn.chosen}</p>}
      {turn.segments.map((segment, index) => (
        <section key={`${segment.knot?.knot ?? 'start'}:${index}`} className="play-segment">
          {segment.knot === null ? null : <h3 tabIndex={-1}>{segment.knot.title}</h3>}
          {segment.lines.length === 0 ? null : (
            <div className="markdown-body reader-text">
              <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
                {segment.lines.join('\n\n')}
              </ReactMarkdown>
            </div>
          )}
        </section>
      ))}
      {turn.choices.length > 0 && !turn.stale ? (
        <ul className="play-choices" aria-label="Choices">
          {turn.choices.map((text, index) => (
            <li key={`${index}:${text}`}>
              <button type="button" className="button-secondary" onClick={() => onChoose(index)}>
                {text}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="play-end">
          {turn.stale ? null : <p>The end.</p>}
          <button type="button" className="button-primary" onClick={onRestart}>
            {turn.stale ? 'Start over' : 'Play again'}
          </button>
        </div>
      )}
      <p className="coordinate-label">
        {chapter === undefined ? null : (
          <Link to={fileHref(slug, chapter.path)}>Edit {chapter.title}</Link>
        )}
        {step === '' || turn.stale ? null : (
          <>
            {chapter === undefined ? null : ' · '}
            <button type="button" className="text-button" onClick={onRestart}>
              Start over
            </button>
          </>
        )}
      </p>
    </article>
  );
}
