import type { BookPlay, PlayKnot } from '@worldbookllm/shared';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
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
  /** Each global variable's value now. */
  state: { name: string; value: string }[];
}

/** Where a play-through starts, all of it in the address so a link reopens it. */
interface Start {
  /** A knot or `knot.stitch` to start from, or null for the story's start. */
  from: string | null;
  /** Variables set before the story starts, as written in the address. */
  set: Record<string, string>;
  /** The seed ink's randomness uses, so `{~…}` and RANDOM replay the same. */
  seed: number;
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
 * tag with no count risen starts the current knot again. A `# break` tag is
 * a scene break.
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
    const tags = story.currentTags ?? [];
    const after = counts();
    let entered = false;
    knots.forEach((entry, index) => {
      if (after[index]! > before[index]!) {
        segments.push({ knot: entry, lines: [] });
        entered = true;
      }
    });
    before = after;
    if (!entered && tags.some((tag) => /^chapter\s*:/u.test(tag))) {
      const knot =
        [...segments].reverse().find((segment) => segment.knot !== null)?.knot ?? current;
      if (knot !== null) segments.push({ knot, lines: [] });
    }
    if (segments.length === 0) segments.push({ knot: null, lines: [] });
    if (tags.some((tag) => /^break\s*$/u.test(tag.trim()))) segments.at(-1)!.lines.push('* * *');
    if (line !== '') segments.at(-1)!.lines.push(line);
  }
  return segments;
}

/** An address value as the ink value it names: true, false, a number, or text. */
function inkValue(text: string): boolean | number | string {
  if (text === 'true' || text === 'false') return text === 'true';
  const number = Number(text);
  return text.trim() !== '' && Number.isFinite(number) ? number : text;
}

function describe(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return JSON.stringify(value);
  return String(value);
}

/** Plays the story through the choices in `path` from `start`. */
function replay(runtime: InkRuntime, play: BookPlay, start: Start, path: readonly number[]): Turn {
  const story = new runtime.Story(play.story);
  story.state.storySeed = start.seed;
  for (const [name, value] of Object.entries(start.set)) {
    if (play.variables.some((variable) => variable.name === name && variable.kind === 'var')) {
      story.variablesState.$(name, inkValue(value));
    }
  }
  const initial = visitCounts(story, play.knots);
  if (start.from !== null) story.ChoosePathString(start.from);
  let segments = runToChoice(story, play.knots, null, initial);
  // The chapter the reader is in, kept across turns whose lines enter none.
  let current: PlayKnot | null = null;
  let chosen: string | null = null;
  const turn = (stale: boolean): Turn => ({
    segments,
    choices: story.currentChoices.map((entry) => entry.text),
    chosen,
    stale,
    state: play.variables.map(({ name }) => ({
      name,
      value: describe(story.variablesState.$(name)),
    })),
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

/** `trust:3,met:true` as variables; entries that do not parse are left out. */
function parseSet(value: string | null): Record<string, string> {
  const set: Record<string, string> = {};
  for (const entry of (value ?? '').split(',')) {
    const match = /^([A-Za-z_]\w*):(.*)$/u.exec(entry.trim());
    if (match) set[match[1]!] = decodeURIComponent(match[2]!);
  }
  return set;
}

function formatSet(set: Record<string, string>): string {
  return Object.entries(set)
    .filter(([, value]) => value.trim() !== '')
    .map(([name, value]) => `${name}:${encodeURIComponent(value.trim())}`)
    .join(',');
}

const newSeed = () => Math.floor(Math.random() * 1_000_000) + 1;

/**
 * Branches → Play: the book's ink, compiled by the server and run here by
 * inkle's own runtime, one passage at a time with its choices as buttons
 * (ADR 0030). The choices made so far, where play started, the variables set
 * before it, and the random seed are all in the address, so the browser's
 * back button steps back and a link reopens the same moment.
 */
export function PlayPage() {
  const api = useApi();
  const { slug, tree } = useBook();
  const story = useLoad(
    (signal) => api.getPlay(slug, signal),
    `${slug}:${tree.files.map((file) => file.hash).join()}`,
  );
  const branchesHref = `/books/${encodeURIComponent(slug)}/branches`;

  return (
    <section className="book-panel play-page" aria-labelledby="play-heading">
      <p className="coordinate-label">
        <Link to={branchesHref}>Branches</Link>
      </p>
      <h2 id="play-heading">Play</h2>
      {story.status === 'loading' ? <LoadingState>Compiling the ink…</LoadingState> : null}
      {story.status === 'error' ? (
        <>
          <ErrorState
            title="The story cannot be played yet"
            message={story.message}
            onRetry={story.reload}
          />
          <p>
            <Link to={`/books/${encodeURIComponent(slug)}/health`}>
              See every problem on Health
            </Link>
            , then come back.
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
  const fromParam = params.get('from');
  const setParam = params.get('set');
  const seedParam = params.get('seed');
  const start = useMemo<Start>(() => {
    // A chapter id (from older links) names its chapter's knot.
    const from =
      fromParam === null
        ? null
        : play.paths.includes(fromParam)
          ? fromParam
          : (play.knots.find((entry) => entry.chapterId === fromParam)?.knot ?? null);
    const seed = Number(seedParam);
    return {
      from,
      set: parseSet(setParam),
      seed: Number.isInteger(seed) && seed > 0 ? seed : 1,
    };
  }, [fromParam, setParam, seedParam, play]);
  const startParams = (next: Start): Record<string, string> => ({
    ...(next.from === null ? {} : { from: next.from }),
    ...(formatSet(next.set) === '' ? {} : { set: formatSet(next.set) }),
    seed: String(next.seed),
  });

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
      return replay(runtime, play, start, path);
    } catch (error) {
      return errorMessage(error);
    }
  }, [runtime, play, start, path]);

  if (loadError !== null) {
    return <ErrorState title="The ink runtime could not load" message={loadError} />;
  }
  if (turn === null) return <LoadingState>Starting ink…</LoadingState>;
  if (typeof turn === 'string') {
    return (
      <>
        <ErrorState title="The ink story stopped with an error" message={turn} />
        <button type="button" className="button-secondary" onClick={() => setParams({})}>
          Play from the start
        </button>
      </>
    );
  }

  const fromKnot = start.from?.split('.')[0];
  const fromTitle =
    fromKnot === undefined
      ? null
      : (play.knots.find((entry) => entry.knot === fromKnot)?.title ?? start.from);
  const presets = Object.keys(start.set).length > 0;

  return (
    <>
      {play.warnings.length > 0 ? (
        <details className="reader-notes">
          <summary>Notes from the compiler ({play.warnings.length})</summary>
          <ul>
            {play.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {start.from === null && !presets ? null : (
        <p className="coordinate-label">
          {start.from === null ? 'Playing from the start' : `Playing from ${fromTitle}`}
          {start.from === null ? '' : start.from.includes('.') ? ` (${start.from})` : ''}
          {presets
            ? `, with ${Object.entries(start.set)
                .map(([name, value]) => `${name} = ${value}`)
                .join(', ')}`
            : ', with every variable as declared'}
          .{' '}
          <button type="button" className="text-button" onClick={() => setParams({})}>
            Play from the start
          </button>
        </p>
      )}
      <Passage
        slug={slug}
        turn={turn}
        step={`${fromParam ?? ''}:${setParam ?? ''}:${seedParam ?? ''}:${path.join('.')}`}
        atStart={path.length === 0}
        onChoose={(index) => setParams({ ...startParams(start), path: [...path, index].join('.') })}
        onRestart={() => setParams(startParams({ ...start, seed: newSeed() }))}
      />
      {turn.state.length > 0 ? (
        <section className="play-state" aria-labelledby="play-state-heading">
          <h3 id="play-state-heading">Story state</h3>
          <ul>
            {turn.state.map(({ name, value }) => (
              <li key={name}>
                <code>{name}</code> {value}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <Playtest
        key={`${fromParam ?? ''}:${setParam ?? ''}`}
        play={play}
        start={start}
        onStart={(next) => setParams(startParams(next))}
      />
      <Saves slug={slug} params={params} onOpen={(saved) => setParams(saved)} />
      <details className="ink-source">
        <summary>ink source</summary>
        <p className="coordinate-label">
          The whole story as one ink file, as Project → Build exports it to open in Inky.
        </p>
        <pre className="build-output">{play.source}</pre>
      </details>
    </>
  );
}

/** Start from any knot or stitch, with variables set first: for testing a branch without replaying to it. */
function Playtest({
  play,
  start,
  onStart,
}: {
  play: BookPlay;
  start: Start;
  onStart: (start: Start) => void;
}) {
  const [from, setFrom] = useState(start.from ?? '');
  const [set, setSet] = useState<Record<string, string>>(start.set);
  const variables = play.variables.filter((variable) => variable.kind === 'var');

  function submit(event: FormEvent) {
    event.preventDefault();
    onStart({ from: from === '' ? null : from, set, seed: start.seed });
  }

  return (
    <details className="play-tools">
      <summary>Playtest from anywhere</summary>
      <form className="play-tools-form" onSubmit={submit}>
        <label>
          Start from
          <select value={from} onChange={(event) => setFrom(event.target.value)}>
            <option value="">The story&apos;s start</option>
            {play.paths.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        </label>
        {variables.length > 0 ? (
          <fieldset>
            <legend>Set variables first (leave blank to keep their declared value)</legend>
            {variables.map((variable) => (
              <label key={variable.name}>
                <code>{variable.name}</code>
                <input
                  value={set[variable.name] ?? ''}
                  spellCheck={false}
                  placeholder="true, 3, or text"
                  onChange={(event) => setSet({ ...set, [variable.name]: event.target.value })}
                />
              </label>
            ))}
          </fieldset>
        ) : null}
        <button type="submit" className="button-secondary">
          Start playing
        </button>
      </form>
    </details>
  );
}

interface Save {
  name: string;
  params: Record<string, string>;
  at: string;
}

function savesKey(slug: string): string {
  return `worldbookllm.play.${slug}.saves`;
}

function readSaves(slug: string): Save[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(savesKey(slug)) ?? '[]');
    return Array.isArray(value) ? (value as Save[]) : [];
  } catch {
    return [];
  }
}

function writeSaves(slug: string, saves: readonly Save[]): void {
  try {
    localStorage.setItem(savesKey(slug), JSON.stringify(saves));
  } catch {
    // Saves are a convenience; a private window may refuse them. The address still works.
  }
}

/** Named moments of a play-through, kept in this browser; each is the address that reopens it. */
function Saves({
  slug,
  params,
  onOpen,
}: {
  slug: string;
  params: URLSearchParams;
  onOpen: (params: Record<string, string>) => void;
}) {
  const [saves, setSaves] = useState(() => readSaves(slug));
  const [name, setName] = useState('');
  const update = (next: Save[]) => {
    setSaves(next);
    writeSaves(slug, next);
  };

  return (
    <details className="play-tools">
      <summary>Saves ({saves.length})</summary>
      <form
        className="play-tools-form"
        onSubmit={(event) => {
          event.preventDefault();
          const label = name.trim() === '' ? `Save ${saves.length + 1}` : name.trim();
          update([
            ...saves.filter((save) => save.name !== label),
            { name: label, params: Object.fromEntries(params), at: new Date().toISOString() },
          ]);
          setName('');
        }}
      >
        <label>
          Name this moment
          <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
        </label>
        <button type="submit" className="button-secondary">
          Save
        </button>
      </form>
      {saves.length === 0 ? null : (
        <ul className="entry-list" aria-label="Saves">
          {saves.map((save) => (
            <li key={save.name}>
              <button type="button" className="text-button" onClick={() => onOpen(save.params)}>
                {save.name}
              </button>
              <span className="coordinate-label">{new Date(save.at).toLocaleString()}</span>
              <button
                type="button"
                className="text-button"
                aria-label={`Delete ${save.name}`}
                onClick={() => update(saves.filter((entry) => entry !== save))}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </details>
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
