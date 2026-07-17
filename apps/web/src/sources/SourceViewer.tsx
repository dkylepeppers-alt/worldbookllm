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
  onUpdated: (source: SourceDetail) => void;
}

export function SourceViewer({ source, onUpdated }: SourceViewerProps) {
  const api = useApi();
  const navigate = useNavigate();
  const { notebookId, updateSource, removeSource } = useNotebookWorkspace();
  const [mode, setMode] = useState<'rendered' | 'raw'>('rendered');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(source.title);
  const [draftContent, setDraftContent] = useState(source.content);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEditing() {
    setDraftTitle(source.title);
    setDraftContent(source.content);
    setError(null);
    setEditing(true);
  }

  async function handleSave() {
    const title = draftTitle.trim();
    if (title.length === 0) {
      setError('Enter a source title.');
      return;
    }
    if (draftContent.length === 0) {
      setError('A source cannot be empty.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateSource(source.id, { title, content: draftContent });
      updateSource({
        id: updated.id,
        notebookId: updated.notebookId,
        title: updated.title,
        slug: updated.slug,
        filePath: updated.filePath,
        origin: updated.origin,
        conversionNotes: updated.conversionNotes,
        category: updated.category,
        tags: updated.tags,
        wordCount: updated.wordCount,
        contentHash: updated.contentHash,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      });
      onUpdated(updated);
      setEditing(false);
    } catch (value) {
      setError(value instanceof ApiClientError ? value.message : 'Could not save the source.');
    } finally {
      setSaving(false);
    }
  }

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

  if (editing) {
    return (
      <article className="source-viewer">
        <header className="source-viewer-header">
          <p className="coordinate-label">Editing source</p>
          <label htmlFor="source-title">Title</label>
          <input
            id="source-title"
            maxLength={300}
            disabled={saving}
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
          />
          {error === null ? null : <p role="alert">{error}</p>}
        </header>
        <label htmlFor="source-content">Markdown</label>
        <textarea
          id="source-content"
          className="source-editor"
          aria-label="Source Markdown"
          disabled={saving}
          value={draftContent}
          onChange={(event) => setDraftContent(event.target.value)}
        />
        <div className="dialog-actions">
          <button
            type="button"
            className="button-secondary"
            disabled={saving}
            onClick={() => setEditing(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="button-primary"
            disabled={saving}
            onClick={() => void handleSave()}
          >
            {saving ? 'Saving…' : 'Save source'}
          </button>
        </div>
      </article>
    );
  }

  return (
    <article className="source-viewer">
      <header className="source-viewer-header">
        <p className="coordinate-label">Markdown · {source.wordCount} words</p>
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
          <button type="button" aria-label={`Edit ${source.title}`} onClick={startEditing}>
            Edit
          </button>
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
