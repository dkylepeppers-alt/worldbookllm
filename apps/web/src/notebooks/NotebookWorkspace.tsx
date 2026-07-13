import type { Notebook, SourceMetadata } from '@worldbookllm/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Outlet, useMatch, useParams } from 'react-router-dom';

import { useApi } from '../api/useApi.js';
import { ApiClientError } from '../api/client.js';
import { ChatPanel } from '../chats/ChatPanel.js';
import { ErrorState, LoadingState } from '../components/RequestState.js';
import { SourceList } from '../sources/SourceList.js';
import {
  NotebookWorkspaceContext,
  type NotebookWorkspaceValue,
  type SourcesState,
} from './notebook-workspace-context.js';

type NotebookState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'error' }
  | { status: 'ready'; notebook: Notebook };

export function NotebookWorkspace() {
  const { notebookId } = useParams();
  const readerMatch = useMatch('/notebooks/:notebookId/sources/:sourceId');
  const api = useApi();
  const [notebookState, setNotebookState] = useState<NotebookState>({ status: 'loading' });
  const [sourcesState, setSourcesState] = useState<SourcesState>({ status: 'loading' });
  const [notebookReloadKey, setNotebookReloadKey] = useState(0);
  const [sourcesReloadKey, setSourcesReloadKey] = useState(0);
  const [lastSourceId, setLastSourceId] = useState<string | null>(null);

  useEffect(() => {
    if (notebookId === undefined) return;
    const controller = new AbortController();
    setNotebookState({ status: 'loading' });
    void api
      .getNotebook(notebookId, controller.signal)
      .then((notebook) => setNotebookState({ status: 'ready', notebook }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setNotebookState(
          error instanceof ApiClientError && error.status === 404
            ? { status: 'not-found' }
            : { status: 'error' },
        );
      });
    return () => controller.abort();
  }, [api, notebookId, notebookReloadKey]);

  useEffect(() => {
    if (notebookId === undefined) return;
    const controller = new AbortController();
    setSourcesState({ status: 'loading' });
    void api
      .listSources(notebookId, controller.signal)
      .then((sources) => setSourcesState({ status: 'ready', sources }))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setSourcesState({ status: 'error' });
        }
      });
    return () => controller.abort();
  }, [api, notebookId, sourcesReloadKey]);

  const addSource = useCallback((source: SourceMetadata) => {
    setSourcesState((current) =>
      current.status === 'ready'
        ? { status: 'ready', sources: [...current.sources, source] }
        : { status: 'ready', sources: [source] },
    );
  }, []);

  const removeSource = useCallback((sourceId: string) => {
    setSourcesState((current) =>
      current.status === 'ready'
        ? { status: 'ready', sources: current.sources.filter((source) => source.id !== sourceId) }
        : current,
    );
    setLastSourceId((current) => (current === sourceId ? null : current));
  }, []);

  const replaceNotebook = useCallback((notebook: Notebook) => {
    setNotebookState({ status: 'ready', notebook });
  }, []);

  const value = useMemo<NotebookWorkspaceValue | null>(() => {
    if (notebookState.status !== 'ready' || notebookId === undefined) return null;
    return {
      notebook: notebookState.notebook,
      notebookId,
      sourcesState,
      retrySources: () => setSourcesReloadKey((current) => current + 1),
      addSource,
      removeSource,
      replaceNotebook,
      lastSourceId,
      setLastSourceId,
    };
  }, [
    addSource,
    lastSourceId,
    notebookId,
    notebookState,
    removeSource,
    replaceNotebook,
    sourcesState,
  ]);

  if (notebookId === undefined) return null;
  if (notebookState.status === 'loading') return <LoadingState>Opening notebook…</LoadingState>;
  if (notebookState.status === 'not-found') {
    return (
      <section className="route-message">
        <p className="coordinate-label">Missing notebook</p>
        <h1>Notebook not found</h1>
        <p>This notebook may have been deleted or moved.</p>
        <Link to="/">Return to notebooks</Link>
      </section>
    );
  }
  if (notebookState.status === 'error') {
    return (
      <ErrorState
        title="Could not open notebook"
        message="The notebook record could not be loaded."
        onRetry={() => setNotebookReloadKey((current) => current + 1)}
      />
    );
  }
  if (value === null) return null;

  const readerHref =
    lastSourceId === null
      ? null
      : `/notebooks/${encodeURIComponent(notebookId)}/sources/${encodeURIComponent(lastSourceId)}`;

  return (
    <NotebookWorkspaceContext.Provider value={value}>
      <section
        className={`workspace${readerMatch === null ? '' : ' reader-open'}`}
        aria-labelledby="workspace-title"
      >
        <header className="workspace-header">
          <div>
            <p className="coordinate-label">Notebook · local source index</p>
            <h1 id="workspace-title">{notebookState.notebook.name}</h1>
          </div>
          <Link className="back-link" to="/">
            All notebooks
          </Link>
        </header>

        <div className="workspace-grid">
          <aside className="source-region" aria-label="Sources">
            <SourceList />
          </aside>
          <section className="reader-region" aria-label="Reader">
            <Outlet />
          </section>
          <aside className="chat-reserve" aria-label="Chat">
            <ChatPanel />
          </aside>
        </div>

        <nav className="mobile-tabs" aria-label="Notebook workspace">
          <Link to="/">Notebooks</Link>
          <Link to={`/notebooks/${notebookId}`}>Sources</Link>
          {readerHref === null ? (
            <span aria-disabled="true">Reader</span>
          ) : (
            <Link to={readerHref}>Reader</Link>
          )}
        </nav>
      </section>
    </NotebookWorkspaceContext.Provider>
  );
}

export function ReaderEmpty() {
  return (
    <div className="reader-empty">
      <p className="coordinate-label">Reader idle</p>
      <h2>Select a source</h2>
      <p>Choose a Markdown source from the index to read it here.</p>
    </div>
  );
}
