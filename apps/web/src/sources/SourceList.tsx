import { useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';

import { ErrorState, LoadingState } from '../components/RequestState.js';
import { useNotebookWorkspace } from '../notebooks/notebook-workspace-context.js';
import { SourcePasteDialog } from './SourcePasteDialog.js';
import { SourceImportDialog } from './SourceImportDialog.js';

const IMPORT_ACCEPT =
  '.md,.markdown,.txt,.json,.pdf,.html,.htm,text/markdown,text/plain,application/json,application/pdf,text/html';

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
  const [importFile, setImportFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="source-index">
      <header className="region-header">
        <div>
          <p className="coordinate-label">Source bearings</p>
          <h2>Sources</h2>
        </div>
        <div className="source-actions">
          <input
            ref={fileInputRef}
            type="file"
            aria-label="Source file"
            accept={IMPORT_ACCEPT}
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) setImportFile(file);
              event.target.value = '';
            }}
          />
          <button
            type="button"
            className="button-secondary"
            onClick={() => fileInputRef.current?.click()}
          >
            Import file
          </button>
          <button type="button" className="button-primary" onClick={() => setPasteOpen(true)}>
            Paste source
          </button>
        </div>
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
          <p>Paste or import your first source to establish a reference point.</p>
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
      {importFile !== null ? (
        <SourceImportDialog file={importFile} onClose={() => setImportFile(null)} />
      ) : null}
    </div>
  );
}
