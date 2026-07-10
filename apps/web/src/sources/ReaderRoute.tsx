import type { SourceDetail } from '@worldbookllm/shared';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useApi } from '../api/useApi.js';
import { ApiClientError } from '../api/client.js';
import { ErrorState, LoadingState } from '../components/RequestState.js';
import { useNotebookWorkspace } from '../notebooks/notebook-workspace-context.js';
import { SourceViewer } from './SourceViewer.js';

type ReaderState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'error' }
  | { status: 'ready'; source: SourceDetail };

export function ReaderRoute() {
  const { sourceId } = useParams();
  const api = useApi();
  const { notebookId, setLastSourceId } = useNotebookWorkspace();
  const [state, setState] = useState<ReaderState>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (sourceId === undefined) return;
    setLastSourceId(sourceId);
    const controller = new AbortController();
    setState({ status: 'loading' });
    void api
      .getSource(sourceId, controller.signal)
      .then((source) => {
        if (source.notebookId !== notebookId) {
          setLastSourceId(null);
          setState({ status: 'not-found' });
          return;
        }
        setState({ status: 'ready', source });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (error instanceof ApiClientError && error.status === 404) {
          setLastSourceId(null);
          setState({ status: 'not-found' });
        } else {
          setState({ status: 'error' });
        }
      });
    return () => controller.abort();
  }, [api, notebookId, reloadKey, setLastSourceId, sourceId]);

  if (sourceId === undefined) return null;
  if (state.status === 'loading') return <LoadingState>Opening source…</LoadingState>;
  if (state.status === 'not-found') {
    return (
      <section className="route-message">
        <p className="coordinate-label">Missing source</p>
        <h2>Source not found</h2>
        <p>This Markdown source may have been deleted or moved.</p>
        <Link to={`/notebooks/${notebookId}`}>Return to sources</Link>
      </section>
    );
  }
  if (state.status === 'error') {
    return (
      <ErrorState
        title="Could not open source"
        message="The source metadata loaded, but its Markdown file could not be read."
        onRetry={() => setReloadKey((current) => current + 1)}
      />
    );
  }
  return <SourceViewer key={state.source.id} source={state.source} />;
}
