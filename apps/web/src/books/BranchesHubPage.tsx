import type { InkConversionPreview, InteractiveStory } from '@worldbookllm/shared';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { DiffDialog } from '../agent/DiffDialog.js';
import { ApiClientError } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { ErrorState, LoadingState } from '../components/RequestState.js';
import { useBook } from './book-context.js';
import { BranchMap } from './BranchMap.js';
import { errorMessage, useLoad } from './useLoad.js';

/**
 * The Branches tab: an interactive book's story at a glance (ADR 0030), its
 * map, and the ways into its choices and Play; for any other book, the way
 * to make it interactive.
 */
export function BranchesHubPage() {
  const { tree } = useBook();
  return (
    <section className="book-panel branches-page" aria-labelledby="branches-hub-heading">
      <p className="coordinate-label">Interactive story</p>
      <h2 id="branches-hub-heading">Branches</h2>
      {tree.book.interactive === true ? (
        <StoryHub />
      ) : tree.book.needsInkConversion === true ? (
        <ConvertOffer legacy />
      ) : (
        <>
          <ConvertOffer legacy={false} />
          <EditionOffer />
        </>
      )}
    </section>
  );
}

function StoryHub() {
  const api = useApi();
  const { slug, tree } = useBook();
  const story = useLoad(
    (signal) => api.getInteractiveStory(slug, signal),
    `${slug}:${tree.files.map((file) => file.hash).join()}`,
  );
  if (story.status === 'loading') return <LoadingState>Reading the story…</LoadingState>;
  if (story.status === 'error') {
    return (
      <ErrorState title="The story could not load" message={story.message} onRetry={story.reload} />
    );
  }
  return <Hub slug={slug} story={story.data} />;
}

function Hub({ slug, story }: { slug: string; story: InteractiveStory }) {
  const base = `/books/${encodeURIComponent(slug)}`;
  const errors = story.diagnostics.filter((entry) => entry.severity === 'error').length;
  const warnings = story.diagnostics.filter((entry) => entry.severity === 'warning').length;
  const choices = story.nodes.reduce((sum, node) => sum + node.choices.length, 0);
  const endings = story.nodes.filter((node) => node.ends && node.reachable).length;
  const count = (value: number, one: string, many: string) =>
    `${value} ${value === 1 ? one : many}`;

  return (
    <>
      <div className="branches-summary" role="status" aria-label="Story summary">
        <p>
          {count(story.chapters.length, 'chapter', 'chapters')}
          {story.compiled
            ? ` · ${count(choices, 'choice', 'choices')} · ${count(endings, 'ending', 'endings')} · ${count(story.variables.length, 'variable', 'variables')}`
            : ''}
        </p>
        {errors > 0 ? (
          <p className="branch-warning">
            The ink does not compile: {count(errors, 'error', 'errors')}.{' '}
            <Link to={`${base}/health`}>See where</Link>
          </p>
        ) : warnings > 0 ? (
          <p className="coordinate-label">
            {count(warnings, 'note', 'notes')} about the story on{' '}
            <Link to={`${base}/health`}>Health</Link>.
          </p>
        ) : null}
        <div className="branch-actions">
          <Link className="button-primary" to={`${base}/branches/edit`}>
            Edit choices
          </Link>
          {story.compiled ? (
            <Link className="button-secondary" to={`${base}/branches/play`}>
              Play from the start
            </Link>
          ) : null}
        </div>
        <p className="coordinate-label">
          Chapters are written in ink under their <em>Chapter Text</em> heading; open one from Write
          to edit it. Variables and shared ink live in <code>ink/</code>.
        </p>
      </div>
      {story.compiled ? (
        <BranchMap slug={slug} story={story} />
      ) : (
        <p className="empty-map">The map appears once the ink compiles.</p>
      )}
    </>
  );
}

/**
 * Converts the book to ink chapters (ADR 0030) after showing the writer
 * every file it would change; the conversion is one change they can undo.
 */
function ConvertOffer({ legacy }: { legacy: boolean }) {
  const api = useApi();
  const { slug, reload } = useBook();
  const [preview, setPreview] = useState<InkConversionPreview | null>(null);
  const [diffPath, setDiffPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="branch-ifid" aria-labelledby="convert-heading">
      <h3 id="convert-heading">{legacy ? 'Convert to ink chapters' : 'Make it interactive'}</h3>
      {legacy ? (
        <p>
          This book's choices are in chapter frontmatter, the earlier format. Interactive books are
          now written in ink: each chapter's text becomes ink that prints the same prose, its
          choices become ink choices, and its flags become variables. Nothing changes until you
          convert, and the conversion can be undone.
        </p>
      ) : (
        <p>
          Write this book as interactive fiction in ink. Each chapter's text becomes ink that prints
          the same prose and runs on to the next chapter, ready for choices. Nothing changes until
          you convert, and the conversion can be undone.
        </p>
      )}
      {preview === null ? (
        <button
          type="button"
          className="button-secondary"
          disabled={busy}
          onClick={() => void run(async () => setPreview(await api.getInkConversion(slug)))}
        >
          {busy ? 'Preparing…' : 'Review the changes'}
        </button>
      ) : (
        <>
          <ul className="entry-list" aria-label="Files the conversion changes">
            {preview.files.map((file) => (
              <li key={file.path}>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setDiffPath(file.path)}
                >
                  {file.path}
                </button>
                <span className="coordinate-label">{file.before === null ? 'new' : 'changed'}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="button-primary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                try {
                  await api.convertToInk(slug, { token: preview.token });
                } catch (caught) {
                  // The book changed since this preview: show the writer the new one to review.
                  if (caught instanceof ApiClientError && caught.code === 'file_changed') {
                    setPreview(null);
                  }
                  throw caught;
                }
                reload();
              })
            }
          >
            {busy ? 'Converting…' : 'Convert to ink chapters'}
          </button>
        </>
      )}
      {error === null ? null : (
        <p className="form-error pre-line" role="alert">
          {error}
        </p>
      )}
      {preview !== null && diffPath !== null ? (
        <DiffDialog
          label="Convert to ink chapters"
          files={preview.files.map((file) => ({
            path: file.path,
            change: file.before === null ? 'created' : 'modified',
          }))}
          path={diffPath}
          loadKey="ink-conversion"
          load={() => Promise.resolve(preview.files)}
          canOpen={(path) =>
            preview.files.some((file) => file.path === path && file.before !== null)
          }
          onClose={() => setDiffPath(null)}
        />
      ) : null}
    </section>
  );
}

/**
 * Keeps this book a novel and makes an interactive copy, as story-skills'
 * adaptation skill advises; the copy is written in ink from the start.
 */
function EditionOffer() {
  const api = useApi();
  const navigate = useNavigate();
  const { slug, tree } = useBook();
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
      <h3 id="edition-heading">Or make an interactive edition</h3>
      <p>
        Keep this book as a novel and branch a copy: an interactive edition with the same chapters
        and bible, written in ink, with its own title and IFID. Later changes to either book stay in
        that book.
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
