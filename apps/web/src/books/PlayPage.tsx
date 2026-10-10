import type { BookPlay, PlayKnot } from '@worldbookllm/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Link, useSearchParams } from 'react-router-dom';
import remarkGfm from 'remark-gfm';

import { useApi } from '../api/useApi.js';
import { ErrorState, LoadingState } from '../components/RequestState.js';
import { useBook } from './book-context.js';
import { fileHref } from './book-sections.js';
import { markdownOf } from './play-markdown.js';
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
  /** Each flag's value now. */
  state: { flag: string; value: boolean }[];
}

function visitCounts(story: InkStory, knots: readonly PlayKnot[]): number[] {
  return knots.map((entry) => {
    try {
      return story.state.VisitCountAtPathString(entry.knot) ?? 0;
    } catch {
      return 0;
    }
  });
}

/**
 * Runs ink until the next choice, grouping its lines by the chapter knot they
 * come from. The story is compiled with every visit counted, so the knots a
 * line entered are the ones whose visit count went up. ink does not count a
 * knot diverting to itself, so a line carrying a knot's opening `chapter`
 * tag with no count risen starts the current knot again.
 */
function runToChoice(
  story: InkStory,
  knots: readonly PlayKnot[],
  // The knot the story was in before, which a knot diverting to itself re-enters.
  current: PlayKnot | null,
  // Counts from before a jump, which counts its knot's visit at once.
  from: number[] = visitCounts(story, knots),
): Segment[] {
  const counts = () => visitCounts(story, knots);
  const segments: Segment[] = [];
  let before = from;
  while (story.canContinue) {
    const line = story.Continue()?.trim() ?? '';
    const after = counts();
    let entered = false;
    knots.forEach((entry, index) => {
      if (after[index]! > before[index]!) {
        segments.push({ knot: entry, lines: [] });
        entered = true;
      }
    });
    before = after;
    if (!entered && story.currentTags?.some((tag) => /^chapter\s*:/u.test(tag)) === true) {
      const knot =
        [...segments].reverse().find((segment) => segment.knot !== null)?.knot ?? current;
      if (knot !== null) segments.push({ knot, lines: [] });
    }
    if (segments.length === 0) segments.push({ knot: null, lines: [] });
    if (line !== '') segments.at(-1)!.lines.push(line);
  }
  return segments;
}

/**
 * Plays the story through the choices in `path`, from the start or, with
 * `from`, from that chapter's knot (flags then start false, as on a first
 * reading that jumped there).
 */
function replay(
  runtime: InkRuntime,
  play: BookPlay,
  from: string | null,
  path: readonly number[],
): Turn {
  const story = new runtime.Story(play.story);
  const knot = play.knots.find((entry) => entry.chapterId === from)?.knot;
  const initial = visitCounts(story, play.knots);
  if (knot !== undefined) story.ChoosePathString(knot);
  let segments = runToChoice(story, play.knots, null, initial);
  // The chapter the reader is in, kept across turns whose lines enter none.
  let current: PlayKnot | null = null;
  let chosen: string | null = null;
  const turn = (stale: boolean): Turn => ({
    segments,
    choices: story.currentChoices.map((entry) => entry.text),
    chosen,
    stale,
    state: play.flags.map((flag) => ({ flag, value: story.variablesState.$(flag) === true })),
  });
  for (const index of path) {
    const choice = story.currentChoices[index];
    if (choice === undefined) return turn(true);
    chosen = choice.text;
    story.ChooseChoiceIndex(index);
    current = [...segments].reverse().find((segment) => segment.knot !== null)?.knot ?? current;
    segments = runToChoice(story, play.knots, current);
  }
  return turn(false);
}

function parsePath(value: string | null): number[] {
  if (value === null || value === '') return [];
  const steps = value.split('.');
  return steps.every((step) => /^\d+$/u.test(step)) ? steps.map(Number) : [];
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
  const branchesHref = `/books/${encodeURIComponent(slug)}/branches/edit`;

  return (
    <section className="book-panel play-page" aria-labelledby="play-heading">
      <p className="coordinate-label">
        <Link to={`/books/${encodeURIComponent(slug)}/branches`}>Branches</Link>
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
  const from = params.get('from');
  const start: Record<string, string> = from === null ? {} : { from };
  const fromKnot = play.knots.find((entry) => entry.chapterId === from);

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
      return replay(runtime, play, from, path);
    } catch (error) {
      return errorMessage(error);
    }
  }, [runtime, play, from, path]);

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
      {fromKnot === undefined ? null : (
        <p className="coordinate-label">
          Playing from {fromKnot.title}, with every flag false.{' '}
          <button type="button" className="text-button" onClick={() => setParams({})}>
            Play from the start
          </button>
        </p>
      )}
      <Passage
        slug={slug}
        turn={turn}
        step={`${from ?? ''}:${path.join('.')}`}
        atStart={path.length === 0}
        onChoose={(index) => setParams({ ...start, path: [...path, index].join('.') })}
        onRestart={() => setParams(start)}
      />
      {turn.state.length > 0 ? (
        <section className="play-state" aria-labelledby="play-state-heading">
          <h3 id="play-state-heading">Story state</h3>
          <ul>
            {turn.state.map(({ flag, value }) => (
              <li key={flag}>
                <code>{flag}</code> {value ? 'true' : 'false'}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <details className="ink-source">
        <summary>ink source</summary>
        <p className="coordinate-label">
          The ink worldbookllm writes for this book, compiled here with inkjs. Download it from
          Project → Build to open it in Inky.
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
  atStart,
  onChoose,
  onRestart,
}: {
  slug: string;
  turn: Turn;
  step: string;
  atStart: boolean;
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
                {markdownOf(segment.lines)}
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
        {atStart || turn.stale ? null : (
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
