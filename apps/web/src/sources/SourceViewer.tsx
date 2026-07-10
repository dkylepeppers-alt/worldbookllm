import type { SourceDetail } from '@worldbookllm/shared';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useNavigate } from 'react-router-dom';
import remarkGfm from 'remark-gfm';

import { useApi } from '../api/useApi.js';
import { ApiClientError } from '../api/client.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { useNotebookWorkspace } from '../notebooks/notebook-workspace-context.js';

interface SourceViewerProps {
  source: SourceDetail;
}

export function SourceViewer({ source }: SourceViewerProps) {
  const api = useApi();
  const navigate = useNavigate();
  const { notebookId, removeSource } = useNotebookWorkspace();
  const [mode, setMode] = useState<'rendered' | 'raw'>('rendered');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      await api.deleteSource(source.id);
      removeSource(source.id);
      await navigate(`/notebooks/${notebookId}`);
    } catch (value) {
      setError(value instanceof ApiClientError ? value.message : 'Could not delete the source.');
      setDeleteOpen(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <article className="source-viewer">
      <header className="source-viewer-header">
        <p className="coordinate-label">Read-only Markdown · {source.wordCount} words</p>
        <h1>{source.title}</h1>
        <code className="source-path">{source.filePath}</code>
        <div className="viewer-toolbar" aria-label="Source display">
          <div className="mode-switch">
            <button
              type="button"
              aria-pressed={mode === 'rendered'}
              onClick={() => setMode('rendered')}
            >
              Rendered
            </button>
            <button type="button" aria-pressed={mode === 'raw'} onClick={() => setMode('raw')}>
              Raw
            </button>
          </div>
          <button
            type="button"
            className="text-danger"
            aria-label={`Delete ${source.title}`}
            onClick={() => setDeleteOpen(true)}
          >
            Delete
          </button>
        </div>
        {error === null ? null : <p role="alert">{error}</p>}
      </header>

      {mode === 'rendered' ? (
        <div className="markdown-body">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ h1: 'h2' }}>
            {source.content}
          </ReactMarkdown>
        </div>
      ) : (
        <pre className="raw-markdown" role="region" aria-label="Raw Markdown">
          <code>{source.content}</code>
        </pre>
      )}

      {deleteOpen ? (
        <ConfirmDialog
          title="Delete source?"
          confirmLabel="Delete source"
          busy={deleting}
          onCancel={() => setDeleteOpen(false)}
          onConfirm={() => void handleDelete()}
        >
          <p>
            Delete <strong>{source.title}</strong> from the notebook and remove its Markdown file?
          </p>
        </ConfirmDialog>
      ) : null}
    </article>
  );
}
