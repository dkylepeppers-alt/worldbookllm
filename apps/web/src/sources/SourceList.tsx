import { useState } from 'react';
import { NavLink } from 'react-router-dom';

import { ErrorState, LoadingState } from '../components/RequestState.js';
import { useNotebookWorkspace } from '../notebooks/notebook-workspace-context.js';
import { SourcePasteDialog } from './SourcePasteDialog.js';

function formatUpdated(value: string): string {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value));
}

export function SourceList() {
  const { notebookId, sourcesState, retrySources } = useNotebookWorkspace();
  const [pasteOpen, setPasteOpen] = useState(false);

  return (
    <div className="source-index">
      <header className="region-header">
        <div>
          <p className="coordinate-label">Source bearings</p>
          <h2>Sources</h2>
        </div>
        <button type="button" className="button-primary" onClick={() => setPasteOpen(true)}>
          Paste source
        </button>
      </header>

      {sourcesState.status === 'loading' ? (
        <LoadingState>Plotting sources…</LoadingState>
      ) : sourcesState.status === 'error' ? (
        <ErrorState
          title="Could not load sources"
          message="The notebook is open, but its source index could not be read."
          onRetry={retrySources}
        />
      ) : sourcesState.sources.length === 0 ? (
        <div className="empty-map">
          <p className="coordinate-label">No sources plotted</p>
          <p>Paste a Markdown document to establish the first reference point.</p>
        </div>
      ) : (
        <ol className="source-list">
          {sourcesState.sources.map((source, index) => (
            <li key={source.id}>
              <NavLink
                aria-label={source.title}
                to={`/notebooks/${notebookId}/sources/${source.id}`}
              >
                <span className="source-spine" aria-hidden="true" />
                <span className="source-order">{String(index + 1).padStart(2, '0')}</span>
                <span className="source-title">{source.title}</span>
                <span className="source-words">{source.wordCount.toLocaleString()} words</span>
                <span className="source-updated">Updated {formatUpdated(source.updatedAt)}</span>
              </NavLink>
            </li>
          ))}
        </ol>
      )}

      {pasteOpen ? <SourcePasteDialog onClose={() => setPasteOpen(false)} /> : null}
    </div>
  );
}
