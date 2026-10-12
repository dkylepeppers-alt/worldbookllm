import type { InteractiveStory } from '@worldbookllm/shared';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { useApi } from '../../api/useApi.js';
import { LoadingState } from '../../components/RequestState.js';
import { errorMessage } from '../useLoad.js';
import type { EditorProblem } from './InkEditor.js';

// CodeMirror loads with the first ink file a writer edits, not with the app.
const InkEditor = lazy(() => import('./InkEditor.js'));

/** How long typing pauses before the story is compiled with the unsaved text. */
const CHECK_DELAY_MS = 500;

interface InkSourceEditorProps {
  slug: string;
  path: string;
  kind: 'chapter' | 'ink';
  /** The chapter's knot name, to play from it; null for an `ink/` file. */
  knot: string | null;
  value: string;
  onChange: (value: string) => void;
}

const SEVERITY = { error: 'error', warning: 'warning', todo: 'to do' } as const;

/**
 * Editing an interactive book's chapter or `ink/` file (ADR 0030, 0031):
 * the ink editor, the story compiled with the unsaved text as the writer
 * types, this file's problems listed (each moves the cursor to its line),
 * and a way to play from this chapter once saved.
 */
export function InkSourceEditor({ slug, path, kind, knot, value, onChange }: InkSourceEditorProps) {
  const api = useApi();
  const [story, setStory] = useState<InteractiveStory | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [goTo, setGoTo] = useState<{ line: number; at: number } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api.checkInk(slug, { path, content: value }, controller.signal).then(
        (checked) => {
          setStory(checked);
          setCheckError(null);
        },
        (error: unknown) => {
          if (!controller.signal.aborted) setCheckError(errorMessage(error));
        },
      );
    }, CHECK_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [api, slug, path, value]);

  const problems = useMemo<EditorProblem[]>(
    () =>
      (story?.diagnostics ?? [])
        .filter((entry) => entry.path === path)
        .map((entry) => ({ severity: entry.severity, line: entry.line, message: entry.message })),
    [story, path],
  );
  const elsewhere = (story?.diagnostics ?? []).filter(
    (entry) => entry.severity === 'error' && entry.path !== path,
  ).length;
  const names = useMemo(
    () => ({
      targets: (story?.nodes ?? [])
        .filter((node) => node.kind !== 'function')
        .map((node) => node.name),
      variables: (story?.variables ?? []).map((variable) => variable.name),
    }),
    [story],
  );

  return (
    <div className="ink-source-editor">
      <p className="coordinate-label">
        {kind === 'chapter'
          ? 'The outline above Chapter Text is Markdown; everything under it is ink.'
          : 'This file is ink: declarations, functions, and knots the whole story shares.'}
        {knot === null ? null : (
          <>
            {' '}
            Divert here with <code>-&gt; {knot}</code>.
          </>
        )}
      </p>
      <Suspense fallback={<LoadingState>Loading the ink editor…</LoadingState>}>
        <InkEditor
          value={value}
          onChange={onChange}
          kind={kind}
          problems={problems}
          names={names}
          label={`${path}, ink`}
          goTo={goTo}
        />
      </Suspense>
      <section className="ink-problems" aria-labelledby="ink-problems-heading" aria-live="polite">
        <h3 id="ink-problems-heading" className="visually-hidden">
          Ink problems
        </h3>
        {checkError !== null ? (
          <p className="form-error">The story could not be checked: {checkError}</p>
        ) : story === null ? (
          <p className="coordinate-label">Checking the ink…</p>
        ) : problems.length === 0 ? (
          <p className="coordinate-label">
            {story.compiled
              ? 'This file compiles, and nothing stands out.'
              : `This file is fine; ${elsewhere} ${elsewhere === 1 ? 'error' : 'errors'} elsewhere stop the story compiling.`}
          </p>
        ) : (
          <ul className="entry-list" aria-label="Problems in this file">
            {problems.map((problem, index) => (
              <li key={`${index}:${problem.line ?? ''}:${problem.message}`}>
                <span className="coordinate-label">{SEVERITY[problem.severity]}</span>
                <span>{problem.message}</span>
                {problem.line === null ? null : (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setGoTo({ line: problem.line!, at: Date.now() })}
                  >
                    Line {problem.line}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {knot !== null && story?.compiled === true ? (
          <p>
            <Link
              to={`/books/${encodeURIComponent(slug)}/branches/play?from=${encodeURIComponent(knot)}`}
            >
              Play from this chapter
            </Link>{' '}
            <span className="coordinate-label">(as last saved)</span>
          </p>
        ) : null}
      </section>
    </div>
  );
}
