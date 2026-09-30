import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useApi } from '../api/useApi.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { ErrorState, LoadingState } from '../components/RequestState.js';
import { useBook } from './book-context.js';
import { fileHref } from './book-sections.js';
import { errorMessage, useLoad } from './useLoad.js';

const PROJECT_FILES = [
  ['story.md', 'Story bible (story.md)'],
  ['style-sheet.md', 'Style sheet'],
  ['plot/timeline.md', 'Timeline'],
  ['continuity/state.md', 'Continuity state'],
] as const;

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

/** Book-level files, change history with undo, and removing the book. */
export function ProjectPage() {
  const api = useApi();
  const navigate = useNavigate();
  const { slug, tree, reload } = useBook();
  const history = useLoad(
    (signal) => api.listCheckpoints(slug, signal),
    `${slug}:${tree.files.map((file) => file.hash).join()}`,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trashing, setTrashing] = useState(false);

  const latestLive =
    history.status === 'ready'
      ? history.data.find((checkpoint) => checkpoint.undoneAt === null)
      : undefined;

  async function undo(id: string) {
    setBusy(true);
    setError(null);
    try {
      await api.undoCheckpoint(slug, id);
      reload();
      history.reload();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function trash() {
    setBusy(true);
    try {
      await api.trashBook(slug);
      await navigate('/books');
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
      setTrashing(false);
    }
  }

  const present = new Set(tree.files.map((file) => file.path));

  return (
    <section className="book-panel" aria-labelledby="project-heading">
      <p className="coordinate-label">{slug}</p>
      <h2 id="project-heading">Project</h2>
      <ul className="entry-list">
        {PROJECT_FILES.filter(([path]) => present.has(path)).map(([path, label]) => (
          <li key={path}>
            <Link to={fileHref(slug, path)}>{label}</Link>
            <span className="coordinate-label">{path}</span>
          </li>
        ))}
      </ul>

      <h3>History</h3>
      {error === null ? null : (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {history.status === 'loading' ? <LoadingState>Reading history…</LoadingState> : null}
      {history.status === 'error' ? (
        <ErrorState
          title="History could not load"
          message={history.message}
          onRetry={history.reload}
        />
      ) : null}
      {history.status === 'ready' ? (
        history.data.length === 0 ? (
          <p className="empty-map">No changes recorded yet.</p>
        ) : (
          <ol className="entry-list" aria-label="History">
            {history.data.map((checkpoint) => (
              <li key={checkpoint.id}>
                <strong>{checkpoint.label}</strong>
                <span className="coordinate-label">
                  {formatTime(checkpoint.createdAt)} · {checkpoint.files.length}{' '}
                  {checkpoint.files.length === 1 ? 'file' : 'files'}
                  {checkpoint.undoneAt === null ? '' : ' · undone'}
                </span>
                {checkpoint.id === latestLive?.id ? (
                  <button
                    type="button"
                    className="button-secondary"
                    disabled={busy}
                    onClick={() => void undo(checkpoint.id)}
                  >
                    Undo
                  </button>
                ) : null}
              </li>
            ))}
          </ol>
        )
      ) : null}

      <h3>Remove</h3>
      <button type="button" className="button-danger" onClick={() => setTrashing(true)}>
        Move book to trash
      </button>
      {trashing ? (
        <ConfirmDialog
          title={`Move ${tree.book.title} to trash?`}
          confirmLabel="Move to trash"
          busy={busy}
          busyLabel="Moving…"
          onCancel={() => setTrashing(false)}
          onConfirm={() => void trash()}
        >
          The book's folder moves to data/trash/. Its files are kept there until you delete them.
        </ConfirmDialog>
      ) : null}
    </section>
  );
}
