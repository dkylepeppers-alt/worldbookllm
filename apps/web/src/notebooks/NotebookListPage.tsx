import type { Notebook } from '@worldbookllm/shared';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useApi } from '../api/useApi.js';
import { ApiClientError } from '../api/client.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { ErrorState, LoadingState } from '../components/RequestState.js';

type CollectionState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; notebooks: Notebook[] };

function formatUpdated(value: string): string {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value));
}

export function NotebookListPage() {
  const api = useApi();
  const navigate = useNavigate();
  const [state, setState] = useState<CollectionState>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const [name, setName] = useState('');
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<Notebook | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);
  const [deleting, setDeleting] = useState<Notebook | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    void api
      .listNotebooks(controller.signal)
      .then((notebooks) => setState({ status: 'ready', notebooks }))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setState({ status: 'error' });
        }
      });
    return () => controller.abort();
  }, [api, reloadKey]);

  const replaceNotebook = useCallback((updated: Notebook) => {
    setState((current) =>
      current.status === 'ready'
        ? {
            status: 'ready',
            notebooks: current.notebooks.map((item) => (item.id === updated.id ? updated : item)),
          }
        : current,
    );
  }, []);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      setMutationError('Enter a notebook name.');
      return;
    }
    setCreating(true);
    setMutationError(null);
    try {
      const created = await api.createNotebook({ name: trimmedName });
      await navigate(`/notebooks/${created.id}`);
    } catch (error) {
      setMutationError(
        error instanceof ApiClientError ? error.message : 'Could not create the notebook.',
      );
    } finally {
      setCreating(false);
    }
  }

  function beginRename(item: Notebook) {
    setRenaming(item);
    setRenameValue(item.name);
    setMutationError(null);
  }

  async function handleRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (renaming === null || renameBusy || renameValue.trim().length === 0) return;
    setRenameBusy(true);
    try {
      const updated = await api.updateNotebook(renaming.id, { name: renameValue.trim() });
      replaceNotebook(updated);
      setRenaming(null);
    } catch (error) {
      setMutationError(
        error instanceof ApiClientError ? error.message : 'Could not rename the notebook.',
      );
    } finally {
      setRenameBusy(false);
    }
  }

  async function handleDelete() {
    if (deleting === null) return;
    setDeleteBusy(true);
    try {
      await api.deleteNotebook(deleting.id);
      setState((current) =>
        current.status === 'ready'
          ? {
              status: 'ready',
              notebooks: current.notebooks.filter((item) => item.id !== deleting.id),
            }
          : current,
      );
      setDeleting(null);
    } catch (error) {
      setDeleting(null);
      setMutationError(
        error instanceof ApiClientError ? error.message : 'Could not delete the notebook.',
      );
    } finally {
      setDeleteBusy(false);
    }
  }

  if (state.status === 'loading') return <LoadingState>Charting notebooks…</LoadingState>;
  if (state.status === 'error') {
    return (
      <ErrorState
        title="Could not load notebooks"
        message="The workspace could not reach its notebook index."
        onRetry={() => setReloadKey((value) => value + 1)}
      />
    );
  }

  return (
    <section className="notebook-atlas" aria-labelledby="notebook-atlas-title">
      <header className="page-intro">
        <p className="coordinate-label">Local index · {state.notebooks.length} notebooks</p>
        <h1 id="notebook-atlas-title">
          {state.notebooks.length === 0 ? 'Begin a worldbook' : 'Notebook atlas'}
        </h1>
        <p>
          Keep each setting, campaign, or story in its own notebook. Every source remains readable
          Markdown on disk.
        </p>
      </header>

      <form className="create-notebook" onSubmit={(event) => void handleCreate(event)}>
        <label htmlFor="notebook-name">Notebook name</label>
        <div className="field-action">
          <input
            id="notebook-name"
            name="name"
            maxLength={200}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="The Ember Coast"
          />
          <button type="submit" className="button-primary" disabled={creating}>
            {creating ? 'Creating…' : 'Create notebook'}
          </button>
        </div>
      </form>

      {mutationError === null ? null : <p role="alert">{mutationError}</p>}

      {state.notebooks.length === 0 ? (
        <div className="empty-map">
          <p className="coordinate-label">No plotted territories</p>
          <p>Name the first notebook to start its source index.</p>
        </div>
      ) : (
        <ol className="notebook-grid">
          {state.notebooks.map((item, index) => (
            <li className="notebook-card" key={item.id}>
              <span className="map-index" aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              {renaming?.id === item.id ? (
                <form className="rename-form" onSubmit={(event) => void handleRename(event)}>
                  <label htmlFor={`rename-${item.id}`}>New name for {item.name}</label>
                  <input
                    id={`rename-${item.id}`}
                    value={renameValue}
                    maxLength={200}
                    onChange={(event) => setRenameValue(event.target.value)}
                  />
                  <div className="inline-actions">
                    <button type="submit" disabled={renameBusy}>
                      {renameBusy ? 'Saving…' : 'Save name'}
                    </button>
                    <button type="button" disabled={renameBusy} onClick={() => setRenaming(null)}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <Link className="notebook-link" to={`/notebooks/${item.id}`}>
                    {item.name}
                  </Link>
                  <p>Updated {formatUpdated(item.updatedAt)}</p>
                  <div className="inline-actions">
                    <button
                      type="button"
                      aria-label={`Rename ${item.name}`}
                      onClick={() => beginRename(item)}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${item.name}`}
                      onClick={() => setDeleting(item)}
                    >
                      Delete
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ol>
      )}

      {deleting === null ? null : (
        <ConfirmDialog
          title="Delete notebook?"
          confirmLabel="Delete notebook"
          busy={deleteBusy}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void handleDelete()}
        >
          <p>
            Delete <strong>{deleting.name}</strong> and every Markdown source inside it? This cannot
            be undone.
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}
