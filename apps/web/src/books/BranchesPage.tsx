import {
  CHOICE_TEXT_RULE,
  CHOICE_TEXT_UNSAFE,
  MAX_CHAPTER_CHOICES,
  type BookBranches,
  type BranchChapter,
  type ChapterChoice,
} from '@worldbookllm/shared';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';

import { useApi } from '../api/useApi.js';
import { ErrorState, LoadingState } from '../components/RequestState.js';
import { useBook } from './book-context.js';
import { fileHref } from './book-sections.js';
import { errorMessage, useLoad } from './useLoad.js';

/** Why a draft choice cannot be saved, or null. */
function choiceError(choice: ChapterChoice): string | null {
  const text = choice.text.trim();
  if (text === '') return 'Add the words the reader picks.';
  if (CHOICE_TEXT_UNSAFE.test(text)) return CHOICE_TEXT_RULE;
  return null;
}

/**
 * Write → Branches: each chapter's choices as a form, and what they add up
 * to: where the story starts, where it ends, and what no path reaches.
 */
export function BranchesPage() {
  const api = useApi();
  const { slug, tree, reload } = useBook();
  const branches = useLoad(
    (signal) => api.getBranches(slug, signal),
    `${slug}:${tree.files.map((file) => file.hash).join()}`,
  );

  return (
    <section className="book-panel branches-page" aria-labelledby="branches-heading">
      <p className="coordinate-label">
        <Link to={`/books/${encodeURIComponent(slug)}/write`}>Chapters</Link>
      </p>
      <h2 id="branches-heading">Branches</h2>
      <p>
        Choices turn the book into an interactive story for the Twine and ink builds. The reader
        starts at the first chapter and picks a choice at the end of each one. Until any chapter has
        a choice, the chapters run in order like a novel. Once one does, a chapter without choices
        is an ending.
      </p>
      {branches.status === 'loading' ? <LoadingState>Reading the chapters…</LoadingState> : null}
      {branches.status === 'error' ? (
        <ErrorState
          title="Branches could not load"
          message={branches.message}
          onRetry={branches.reload}
        />
      ) : null}
      {branches.status === 'ready' ? (
        <BranchesView slug={slug} branches={branches.data} onChanged={reload} />
      ) : null}
    </section>
  );
}

function BranchesView({
  slug,
  branches,
  onChanged,
}: {
  slug: string;
  branches: BookBranches;
  onChanged: () => void;
}) {
  const { chapters } = branches;
  if (chapters.length === 0) {
    return <p className="empty-map">No chapters yet. Add chapters on the Write tab first.</p>;
  }
  const ids = new Set(chapters.map((chapter) => chapter.id));
  const endings = chapters.filter((chapter) => chapter.ending && chapter.reachable).length;
  const unreachable = chapters.filter((chapter) => !chapter.reachable);
  const broken = chapters.filter(
    (chapter) =>
      chapter.problems.length > 0 || chapter.choices.some((choice) => !ids.has(choice.to)),
  );
  const playHref = `/books/${encodeURIComponent(slug)}/write/play`;

  return (
    <>
      <div className="branches-summary" role="status" aria-label="Story map">
        {branches.branching ? (
          <p>
            {chapters.length} {chapters.length === 1 ? 'chapter' : 'chapters'} · {endings}{' '}
            {endings === 1 ? 'ending' : 'endings'} the reader can reach
          </p>
        ) : (
          <p>No chapter has choices yet, so this book reads straight through.</p>
        )}
        {broken.length > 0 ? (
          <p className="branch-warning">
            Fix the choices in{' '}
            {broken.map((chapter, index) => (
              <span key={chapter.id}>
                {index > 0 ? ', ' : ''}
                <a href={`#branch-${chapter.id}`}>{chapter.title}</a>
              </span>
            ))}{' '}
            before building: the Twine and ink builds refuse choices that lead nowhere.
          </p>
        ) : null}
        {unreachable.length > 0 ? (
          <p className="branch-warning">
            No path of choices reaches{' '}
            {unreachable.map((chapter, index) => (
              <span key={chapter.id}>
                {index > 0 ? ', ' : ''}
                <a href={`#branch-${chapter.id}`}>{chapter.title}</a>
              </span>
            ))}
            . Add a choice that leads there, or remove the chapter.
          </p>
        ) : null}
        {broken.length === 0 ? (
          <Link className="button-primary" to={playHref}>
            Play from the start
          </Link>
        ) : null}
      </div>

      <IfidPanel
        slug={slug}
        ifid={branches.ifid}
        invalidIfid={branches.invalidIfid}
        onChanged={onChanged}
      />

      <ol className="branch-list" aria-label="Chapters and their choices">
        {chapters.map((chapter, position) => (
          <ChapterChoices
            // A save changes the file's hash, which resets the draft.
            key={`${chapter.id}:${chapter.hash}`}
            slug={slug}
            chapter={chapter}
            chapters={chapters}
            next={chapters[position + 1]}
            branching={branches.branching}
            onSaved={onChanged}
          />
        ))}
      </ol>
    </>
  );
}

function IfidPanel({
  slug,
  ifid,
  invalidIfid,
  onChanged,
}: {
  slug: string;
  ifid: string | null;
  invalidIfid: string | null;
  onChanged: () => void;
}) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pin() {
    setBusy(true);
    setError(null);
    try {
      await api.pinIfid(slug);
      onChanged();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="branch-ifid" aria-labelledby="ifid-heading">
      <h3 id="ifid-heading">Story identity</h3>
      {ifid === null ? (
        <>
          {invalidIfid === null ? (
            <p>
              Twine and story archives tell stories apart by an IFID. This book has none pinned yet,
              so each build makes one from the title, and retitling the book would change it. Pin it
              before you share the story.
            </p>
          ) : (
            <p className="branch-warning">
              story.md has <code>ifid: {invalidIfid}</code>, which is not a valid IFID (a version 4
              UUID), so the Twine and ink builds refuse it. Replace it with a valid one.
            </p>
          )}
          <button
            type="button"
            className="button-secondary"
            disabled={busy}
            onClick={() => void pin()}
          >
            {busy ? 'Pinning…' : invalidIfid === null ? 'Pin the IFID' : 'Replace the IFID'}
          </button>
        </>
      ) : (
        <p>
          IFID <code>{ifid}</code>, kept in story.md. It stays the same if you retitle the book.
        </p>
      )}
      {error === null ? null : (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function ChapterChoices({
  slug,
  chapter,
  chapters,
  next,
  branching,
  onSaved,
}: {
  slug: string;
  chapter: BranchChapter;
  chapters: readonly BranchChapter[];
  next: BranchChapter | undefined;
  branching: boolean;
  onSaved: () => void;
}) {
  const api = useApi();
  const [draft, setDraft] = useState<ChapterChoice[]>(chapter.choices);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  const ids = new Set(chapters.map((entry) => entry.id));
  const dirty = JSON.stringify(draft) !== JSON.stringify(chapter.choices);
  // Saving also rewrites malformed entries, so a chapter with problems can always save.
  const canSave = dirty || chapter.problems.length > 0;
  const errors = draft.map(choiceError);
  const headingId = `branch-${chapter.id}-heading`;
  // A choice can lead back to its own chapter, so even a one-chapter book can branch.
  const defaultTarget =
    next?.id ?? chapters.find((entry) => entry.id !== chapter.id)?.id ?? chapter.id;

  function update(index: number, change: Partial<ChapterChoice>) {
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
      await api.setChapterChoices(slug, chapter.id, {
        expectedHash: chapter.hash,
        choices: draft.map((choice) => ({ text: choice.text.trim(), to: choice.to })),
      });
      onSaved();
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  return (
    <li id={`branch-${chapter.id}`} className="branch-card">
      <form aria-labelledby={headingId} onSubmit={(event) => void save(event)}>
        <div className="branch-card-heading">
          <h3 id={headingId}>
            <Link to={fileHref(slug, chapter.path)}>{chapter.title}</Link>
          </h3>
          <span className="coordinate-label">{chapter.id}</span>
          <ul className="branch-tags" aria-label="Status">
            {chapter.start ? <li className="branch-tag">Start</li> : null}
            {chapter.ending && chapter.reachable ? <li className="branch-tag">Ending</li> : null}
            {chapter.reachable ? null : (
              <li className="branch-tag branch-tag-problem">Not reachable</li>
            )}
          </ul>
        </div>

        {chapter.problems.length > 0 ? (
          <div className="branch-warning">
            <p>
              Some choices in this chapter&apos;s frontmatter are malformed. Saving replaces them
              with the list below.
            </p>
            <ul>
              {chapter.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {draft.length === 0 ? (
          <p className="coordinate-label">
            {branching
              ? 'No choices: the story ends here.'
              : next === undefined
                ? 'The last chapter: the story ends here.'
                : `No choices: the reader goes on to ${next.title}.`}
          </p>
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
                  <label>
                    Leads to
                    <select
                      value={choice.to}
                      onChange={(event) => update(index, { to: event.target.value })}
                    >
                      {ids.has(choice.to) ? null : (
                        <option value={choice.to}>{choice.to} (missing chapter)</option>
                      )}
                      {chapters.map((target) => (
                        <option key={target.id} value={target.id}>
                          {target.title}
                          {target.id === chapter.id ? ' (this chapter)' : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="button-secondary"
                    aria-label={`Remove choice ${index + 1}`}
                    onClick={() => setDraft((current) => current.filter((_, at) => at !== index))}
                  >
                    Remove
                  </button>
                  {ids.has(choice.to) ? null : (
                    <p className="form-error">
                      {choice.to} is not a chapter in this book. Pick where this choice leads.
                    </p>
                  )}
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
          {draft.length < MAX_CHAPTER_CHOICES ? (
            <button
              type="button"
              className="button-secondary"
              onClick={() => setDraft((current) => [...current, { text: '', to: defaultTarget }])}
            >
              Add a choice
            </button>
          ) : null}
          {branching && draft.length === 0 && next !== undefined ? (
            <button
              type="button"
              className="button-secondary"
              onClick={() => setDraft([{ text: 'Continue', to: next.id }])}
            >
              Continue to {next.title}
            </button>
          ) : null}
          {canSave ? (
            <button type="submit" className="button-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save choices'}
            </button>
          ) : null}
          {dirty && !busy ? (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setDraft(chapter.choices);
                setShowErrors(false);
                setError(null);
              }}
            >
              Discard changes
            </button>
          ) : null}
        </div>
        {dirty && !branching && chapter.choices.length === 0 && draft.length > 0 ? (
          <p className="coordinate-label">
            This is the book&apos;s first choice. Once it is saved, every chapter without choices
            becomes an ending, so give the chapters that should run on a choice too.
          </p>
        ) : null}
        {error === null ? null : (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </li>
  );
}
