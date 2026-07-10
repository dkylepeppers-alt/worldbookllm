import { type FormEvent, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useApi } from '../api/useApi.js';
import { ApiClientError } from '../api/client.js';
import { useDialogLifecycle } from '../components/useDialogLifecycle.js';
import { useNotebookWorkspace } from '../notebooks/notebook-workspace-context.js';

interface SourcePasteDialogProps {
  onClose: () => void;
}

export function SourcePasteDialog({ onClose }: SourcePasteDialogProps) {
  const api = useApi();
  const navigate = useNavigate();
  const { notebookId, addSource, setLastSourceId } = useNotebookWorkspace();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useDialogLifecycle(titleRef, onClose);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (title.trim().length === 0) {
      setError('Enter a source title.');
      return;
    }
    if (content.length === 0) {
      setError('Paste Markdown content.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await api.createSource(notebookId, { title: title.trim(), content });
      addSource(created);
      setLastSourceId(created.id);
      await navigate(`/notebooks/${notebookId}/sources/${created.id}`);
      onClose();
    } catch (value) {
      setError(value instanceof ApiClientError ? value.message : 'Could not save the source.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dialog-backdrop">
      <section
        className="dialog-card source-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="paste-source-title"
      >
        <p className="coordinate-label">New source · paste origin</p>
        <h2 id="paste-source-title">Paste a Markdown source</h2>
        <form onSubmit={(event) => void handleSubmit(event)}>
          <label htmlFor="source-title">Source title</label>
          <input
            ref={titleRef}
            id="source-title"
            maxLength={300}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <label htmlFor="source-content">Markdown content</label>
          <textarea
            id="source-content"
            rows={14}
            maxLength={10_485_760}
            value={content}
            onChange={(event) => setContent(event.target.value)}
          />
          {error === null ? null : <p role="alert">{error}</p>}
          <div className="dialog-actions">
            <button type="button" className="button-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="button-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save source'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
