import {
  MAX_CLOSING_CHOICES,
  type ChapterEnding,
  type ChapterEndingDetail,
  type ClosingChoice,
  type InteractiveStory,
  type StoryChapter,
} from '@worldbookllm/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';

import { ApiClientError } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { ErrorState, LoadingState } from '../components/RequestState.js';
import { useBook } from './book-context.js';
import { fileHref } from './book-sections.js';
import { errorMessage, useLoad } from './useLoad.js';

interface DraftChoice {
  text: string;
  to: string;
  once: boolean;
  condition: string;
  /** One `~` line per line, without the `~`. */
  effects: string;
}

const toDraft = (choice: ClosingChoice): DraftChoice => ({
  ...choice,
  effects: choice.effects.join('\n'),
});

const fromDraft = (choice: DraftChoice): ClosingChoice => ({
  text: choice.text.trim(),
  to: choice.to,
  once: choice.once,
  condition: choice.condition.trim(),
  effects: choice.effects
    .split('\n')
    .map((line) => line.replace(/^\s*~\s*/u, '').trim())
    .filter((line) => line !== ''),
});

/** Whether two endings write the same ink, whatever order their fields are in. */
function sameEnding(left: ChapterEnding, right: ChapterEnding): boolean {
  const key = (ending: ChapterEnding) =>
    JSON.stringify([
      ending.then,
      ending.choices.map((choice) => [
        choice.text,
        choice.to,
        choice.once,
        choice.condition,
        choice.effects,
      ]),
    ]);
  return key(left) === key(right);
}

interface Target {
  value: string;
  label: string;
}

/** Where a choice can lead: every chapter, knot, and stitch, and the end. */
function targetsOf(story: InteractiveStory): Target[] {
  const titles = new Map(story.chapters.map((chapter) => [chapter.knot, chapter.title]));
  return [
    ...story.nodes
      .filter((node) => node.kind !== 'function')
      .map((node) => {
        const [knot, stitch] = node.name.split('.');
        const title = titles.get(knot!) ?? knot!;
        return { value: node.name, label: stitch === undefined ? title : `${title} › ${stitch}` };
      }),
    { value: 'END', label: 'The end of the story' },
  ];
}

/**
 * Branches → Choices: each chapter's closing choices as a form (ADR 0030).
 * Each saves as ink at the end of the chapter's text; anything richer, a
 * weave inside the chapter or logic between its choices, is edited as ink.
 */
export function BranchesPage() {
  const api = useApi();
  const { slug, tree, reload } = useBook();
  const story = useLoad(
    (signal) => api.getInteractiveStory(slug, signal),
    `${slug}:${tree.files.map((file) => file.hash).join()}`,
  );
  const { hash } = useLocation();
  const ready = story.status === 'ready';
  // A link from the map names a chapter's card; bring it into view once it is there.
  useEffect(() => {
    if (!ready || !hash.startsWith('#branch-')) return;
    const card = document.getElementById(decodeURIComponent(hash.slice(1)));
    // jsdom has no scrollIntoView.
    if (card !== null && 'scrollIntoView' in card) card.scrollIntoView({ block: 'start' });
    card?.querySelector<HTMLElement>('h3 a')?.focus({ preventScroll: true });
  }, [ready, hash]);

  if (tree.book.interactive !== true) {
    return <Navigate to={`/books/${encodeURIComponent(slug)}/branches`} replace />;
  }
  return (
    <section className="book-panel branches-page" aria-labelledby="branches-heading">
      <p className="coordinate-label">
        <Link to={`/books/${encodeURIComponent(slug)}/branches`}>Branches</Link>
      </p>
      <h2 id="branches-heading">Choices</h2>
      <p>
        The choices each chapter ends with. A choice can be offered only once, only when a condition
        holds (<code>trust &gt; 1</code>, <code>not met_venn</code>, or a knot name such as{' '}
        <code>chapter_03</code> for "has read it"), and change variables when picked (
        <code>trust += 1</code>). They are saved as ink at the end of the chapter&apos;s text; a
        variable they set that the story does not declare is added to <code>ink/variables.md</code>.
      </p>
      {story.status === 'loading' ? <LoadingState>Reading the story…</LoadingState> : null}
      {story.status === 'error' ? (
        <ErrorState
          title="The story could not load"
          message={story.message}
          onRetry={story.reload}
        />
      ) : null}
      {story.status === 'ready' ? (
        story.data.chapters.length === 0 ? (
          <p className="empty-map">No chapters yet. Add chapters on the Write tab first.</p>
        ) : (
          <ol className="branch-list" aria-label="Chapters and their choices">
            {story.data.chapters.map((chapter) => (
              <ChapterCard
                // A save changes the file's hash, which reloads the card.
                key={`${chapter.id}:${chapter.hash}`}
                slug={slug}
                chapter={chapter}
                story={story.data}
                onSaved={reload}
              />
            ))}
          </ol>
        )
      ) : null}
    </section>
  );
}

function ChapterCard({
  slug,
  chapter,
  story,
  onSaved,
}: {
  slug: string;
  chapter: StoryChapter;
  story: InteractiveStory;
  onSaved: () => void;
}) {
  const api = useApi();
  const detail = useLoad(
    (signal) => api.getChapterEnding(slug, chapter.id, signal),
    `${chapter.id}:${chapter.hash}`,
  );
  const node = story.nodes.find((entry) => entry.name === chapter.knot);
  const headingId = `branch-${chapter.id}-heading`;

  return (
    <li id={`branch-${chapter.id}`} className="branch-card">
      <div className="branch-card-heading">
        <h3 id={headingId}>
          <Link to={fileHref(slug, chapter.path)}>{chapter.title}</Link>
        </h3>
        <code className="coordinate-label">{chapter.knot}</code>
        {story.compiled ? (
          <Link
            className="coordinate-label"
            to={`/books/${encodeURIComponent(slug)}/branches/play?from=${encodeURIComponent(chapter.knot)}`}
          >
            Play from here
          </Link>
        ) : null}
        <ul className="branch-tags" aria-label="Status">
          {story.start?.split('.')[0] === chapter.knot ? (
            <li className="branch-tag">Start</li>
          ) : null}
          {node?.ends ? <li className="branch-tag">Ending</li> : null}
          {node !== undefined && !node.reachable ? (
            <li className="branch-tag branch-tag-problem">Not reachable</li>
          ) : null}
        </ul>
      </div>
      {detail.status === 'loading' ? <LoadingState>Reading its ending…</LoadingState> : null}
      {detail.status === 'error' ? (
        <ErrorState
          title="The ending could not load"
          message={detail.message}
          onRetry={detail.reload}
        />
      ) : null}
      {detail.status === 'ready' ? (
        detail.data.editable ? (
          <EndingForm
            slug={slug}
            chapter={chapter}
            detail={detail.data}
            targets={targetsOf(story)}
            headingId={headingId}
            onSaved={onSaved}
          />
        ) : (
          <div className="branch-warning">
            <p>{detail.data.reason}</p>
            {node !== undefined && node.choices.length > 0 ? (
              <ul aria-label={`Choices in ${chapter.title}`}>
                {node.choices.map((choice, index) => (
                  <li key={`${index}:${choice.text}`}>
                    {choice.text}
                    {choice.target === null ? '' : ` → ${choice.target}`}
                    {choice.condition === null ? '' : ` (only if ${choice.condition})`}
                  </li>
                ))}
              </ul>
            ) : null}
            <Link to={fileHref(slug, chapter.path)}>Edit {chapter.title} as ink</Link>
          </div>
        )
      ) : null}
    </li>
  );
}

function EndingForm({
  slug,
  chapter,
  detail,
  targets,
  headingId,
  onSaved,
}: {
  slug: string;
  chapter: StoryChapter;
  detail: ChapterEndingDetail;
  targets: readonly Target[];
  headingId: string;
  onSaved: () => void;
}) {
  const api = useApi();
  const [draft, setDraft] = useState<DraftChoice[]>(() => detail.ending.choices.map(toDraft));
  const [then, setThen] = useState(detail.ending.then);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  const ending: ChapterEnding = { choices: draft.map(fromDraft), then };
  const dirty = !sameEnding(ending, detail.ending);
  const errors = draft.map((choice) =>
    choice.text.trim() === '' ? 'Each choice needs text' : null,
  );
  const known = new Set(targets.map((target) => target.value));
  const defaultTarget = targets.find((target) => target.value !== chapter.knot)?.value ?? 'END';

  function update(index: number, change: Partial<DraftChoice>) {
    setDraft((current) =>
      current.map((choice, at) => (at === index ? { ...choice, ...change } : choice)),
    );
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (errors.some((entry) => entry !== null)) {
      setShowErrors(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.setChapterEnding(slug, chapter.id, { ending, expectedHash: detail.hash });
      onSaved();
    } catch (caught) {
      setStale(caught instanceof ApiClientError && caught.code === 'file_changed');
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  const targetSelect = (value: string, onChange: (value: string) => void, label: string) => (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {known.has(value) ? null : <option value={value}>{value} (not in the story)</option>}
        {targets.map((target) => (
          <option key={target.value} value={target.value}>
            {target.label}
            {target.value === chapter.knot ? ' (this chapter)' : ''}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <form aria-labelledby={headingId} onSubmit={(event) => void save(event)}>
      {draft.length === 0 ? (
        <div className="choice-then">
          {targetSelect(then, setThen, 'With no choices, go on to')}
        </div>
      ) : (
        <ol className="choice-rows" aria-label={`Choices in ${chapter.title}`}>
          {draft.map((choice, index) => {
            const errorId = `branch-${chapter.id}-choice-${index}-error`;
            const invalid = showErrors && errors[index] !== null;
            return (
              <li key={index} className="choice-row">
                <label>
                  Choice {index + 1}
                  <input
                    value={choice.text}
                    maxLength={200}
                    placeholder="Follow the light"
                    aria-invalid={invalid}
                    aria-describedby={invalid ? errorId : undefined}
                    onChange={(event) => update(index, { text: event.target.value })}
                  />
                </label>
                {targetSelect(choice.to, (to) => update(index, { to }), 'Leads to')}
                <button
                  type="button"
                  className="button-secondary"
                  aria-label={`Remove choice ${index + 1}`}
                  onClick={() => setDraft((current) => current.filter((_, at) => at !== index))}
                >
                  Remove
                </button>
                <div className="choice-state">
                  <label>
                    Only if
                    <input
                      value={choice.condition}
                      placeholder="trust > 1 and not met_venn"
                      spellCheck={false}
                      onChange={(event) => update(index, { condition: event.target.value })}
                    />
                  </label>
                  <label>
                    When picked
                    <textarea
                      value={choice.effects}
                      rows={Math.max(1, choice.effects.split('\n').length)}
                      placeholder="trust += 1"
                      spellCheck={false}
                      onChange={(event) => update(index, { effects: event.target.value })}
                    />
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={choice.once}
                      onChange={(event) => update(index, { once: event.target.checked })}
                    />
                    Offer only once
                  </label>
                </div>
                {invalid ? (
                  <p id={errorId} className="form-error">
                    {errors[index]}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      <div className="branch-actions">
        {draft.length < MAX_CLOSING_CHOICES ? (
          <button
            type="button"
            className="button-secondary"
            onClick={() =>
              setDraft((current) => [
                ...current,
                { text: '', to: defaultTarget, once: false, condition: '', effects: '' },
              ])
            }
          >
            Add a choice
          </button>
        ) : null}
        {dirty ? (
          <button type="submit" className="button-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save choices'}
          </button>
        ) : null}
        {dirty && !busy ? (
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setDraft(detail.ending.choices.map(toDraft));
              setThen(detail.ending.then);
              setShowErrors(false);
              setError(null);
            }}
          >
            Discard changes
          </button>
        ) : null}
      </div>
      {error === null ? null : (
        <div className="form-error" role="alert">
          <p className="pre-line">{error}</p>
          {stale ? (
            <button type="button" className="button-secondary" onClick={onSaved}>
              Reload {chapter.title}
            </button>
          ) : null}
        </div>
      )}
    </form>
  );
}
