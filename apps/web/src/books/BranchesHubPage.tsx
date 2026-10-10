import type { BookBranches } from '@worldbookllm/shared';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useApi } from '../api/useApi.js';
import { ErrorState, LoadingState } from '../components/RequestState.js';
import { useBook } from './book-context.js';
import { BranchMap } from './BranchMap.js';
import { errorMessage, useLoad } from './useLoad.js';

/**
 * The Branches tab: the book's chapters as a map of choices, what it adds
 * up to, and the way into editing choices, playing the story, or starting
 * an interactive edition of a book that has none yet.
 */
export function BranchesHubPage() {
  const api = useApi();
  const { slug, tree } = useBook();
  const branches = useLoad(
    (signal) => api.getBranches(slug, signal),
    `${slug}:${tree.files.map((file) => file.hash).join()}`,
  );

  return (
    <section className="book-panel branches-page" aria-labelledby="branches-hub-heading">
      <p className="coordinate-label">Interactive story</p>
      <h2 id="branches-hub-heading">Branches</h2>
      {branches.status === 'loading' ? <LoadingState>Reading the chapters…</LoadingState> : null}
      {branches.status === 'error' ? (
        <ErrorState
          title="Branches could not load"
          message={branches.message}
          onRetry={branches.reload}
        />
      ) : null}
      {branches.status === 'ready' ? <Hub slug={slug} branches={branches.data} /> : null}
    </section>
  );
}

function Hub({ slug, branches }: { slug: string; branches: BookBranches }) {
  const base = `/books/${encodeURIComponent(slug)}/branches`;
  const { chapters } = branches;
  if (chapters.length === 0) {
    return <p className="empty-map">No chapters yet. Add chapters on the Write tab first.</p>;
  }
  const ids = new Set(chapters.map((chapter) => chapter.id));
  const endings = chapters.filter((chapter) => chapter.ending && chapter.reachable).length;
  const unreachable = chapters.filter((chapter) => !chapter.reachable).length;
  const broken = chapters.filter(
    (chapter) =>
      chapter.problems.length > 0 || chapter.choices.some((choice) => !ids.has(choice.to)),
  ).length;
  const invalidIfid = branches.invalidIfid !== null;
  const choices = chapters.reduce((sum, chapter) => sum + chapter.choices.length, 0);

  return (
    <>
      <div className="branches-summary" role="status" aria-label="Story map">
        {branches.branching ? (
          <p>
            {chapters.length} {chapters.length === 1 ? 'chapter' : 'chapters'} · {choices}{' '}
            {choices === 1 ? 'choice' : 'choices'} · {endings}{' '}
            {endings === 1 ? 'ending' : 'endings'}
            {branches.flags.length > 0
              ? ` · ${branches.flags.length} ${branches.flags.length === 1 ? 'flag' : 'flags'}`
              : ''}
          </p>
        ) : (
          <p>No chapter has choices yet, so this book reads straight through.</p>
        )}
        {broken > 0 || invalidIfid || unreachable > 0 ? (
          <p className="branch-warning">
            {broken > 0
              ? `${broken} ${broken === 1 ? 'chapter has' : 'chapters have'} choices the builds refuse. `
              : ''}
            {invalidIfid ? 'The builds refuse the invalid IFID. ' : ''}
            {unreachable > 0
              ? `${unreachable} ${unreachable === 1 ? 'chapter is' : 'chapters are'} not reachable.`
              : ''}{' '}
            <Link to={`${base}/edit`}>Fix them</Link>
          </p>
        ) : null}
        <div className="branch-actions">
          <Link className="button-primary" to={`${base}/edit`}>
            Edit choices
          </Link>
          {broken === 0 && !invalidIfid ? (
            <Link className="button-secondary" to={`${base}/play`}>
              Play from the start
            </Link>
          ) : null}
        </div>
      </div>

      {branches.branching ? null : <EditionOffer slug={slug} />}

      <BranchMap slug={slug} branches={branches} />
    </>
  );
}

/**
 * For a book without choices: branch it here, or copy it first as story-
 * skills' adaptation skill advises, so the novel stays linear.
 */
function EditionOffer({ slug }: { slug: string }) {
  const api = useApi();
  const navigate = useNavigate();
  const { tree } = useBook();
  const [title, setTitle] = useState(`${tree.book.title} (interactive edition)`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const edition = await api.createInteractiveEdition(slug, { title: title.trim() });
      navigate(`/books/${encodeURIComponent(edition.slug)}/branches`);
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  return (
    <section className="branch-ifid" aria-labelledby="edition-heading">
      <h3 id="edition-heading">Make it interactive</h3>
      <p>
        Add choices to these chapters on <em>Edit choices</em>, or keep this book as a novel and
        branch a copy: an interactive edition with the same chapters and bible, its own title, and
        its own IFID. Later changes to either book stay in that book.
      </p>
      <form
        className="add-entity"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <label>
          Edition title
          <input
            value={title}
            maxLength={200}
            required
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <button type="submit" className="button-secondary" disabled={busy || title.trim() === ''}>
          {busy ? 'Copying the book…' : 'Make an interactive edition'}
        </button>
      </form>
      {error === null ? null : (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
