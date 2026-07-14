import type { SourcePreview, SourcePreviewFormat } from '@worldbookllm/shared';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ApiClientError } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { useDialogLifecycle } from '../components/useDialogLifecycle.js';
import { useNotebookWorkspace } from '../notebooks/notebook-workspace-context.js';

interface SourceImportDialogProps {
  file: File;
  onClose: () => void;
}

const FORMAT_LABELS: Record<SourcePreviewFormat, string> = {
  markdown: 'Markdown file',
  text: 'Plain text',
  pdf: 'PDF',
  html: 'HTML page',
  lorebook: 'Lorebook',
  character: 'Character card',
  json: 'JSON file',
};

export function SourceImportDialog({ file, onClose }: SourceImportDialogProps) {
  const api = useApi();
  const navigate = useNavigate();
  const { notebookId, addSource, setLastSourceId } = useNotebookWorkspace();
  const [preview, setPreview] = useState<SourcePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [converting, setConverting] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modified, setModified] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  function requestClose() {
    if (modified && !window.confirm('Discard your changes to this import?')) return;
    onClose();
  }

  useDialogLifecycle(cancelRef, requestClose);

  useEffect(() => {
    const controller = new AbortController();
    api
      .previewFileImport(notebookId, file, controller.signal)
      .then((result) => {
        setPreview(result);
        setModified(false);
      })
      .catch((value: unknown) => {
        if (value instanceof DOMException && value.name === 'AbortError') return;
        setError(
          value instanceof ApiClientError ? value.message : 'Could not read the imported file.',
        );
      })
      .finally(() => setConverting(false));
    return () => controller.abort();
  }, [api, file, notebookId]);

  function updateEntry(index: number, field: 'title' | 'markdown', value: string) {
    setPreview((current) =>
      current === null
        ? null
        : {
            ...current,
            entries: current.entries.map((entry, entryIndex) =>
              entryIndex === index ? { ...entry, [field]: value } : entry,
            ),
          },
    );
    setModified(true);
  }

  async function saveImport() {
    if (preview === null) return;
    if (
      preview.entries.some((entry) => entry.title.trim() === '' || entry.markdown.trim() === '')
    ) {
      setError('Every imported source needs a title and Markdown content.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await api.createSources(
        notebookId,
        preview.entries.map((entry) => ({
          title: entry.title.trim(),
          content: entry.markdown,
          origin: preview.origin,
          conversionNotes: preview.conversionNotes,
        })),
      );
      for (const source of created) addSource(source);
      const last = created.at(-1);
      if (last !== undefined) {
        setLastSourceId(last.id);
        await navigate(`/notebooks/${notebookId}/sources/${last.id}`);
      }
      setModified(false);
      onClose();
    } catch (value) {
      setError(value instanceof ApiClientError ? value.message : 'Could not save the import.');
    } finally {
      setSaving(false);
    }
  }

  const originName = preview?.origin.type === 'file' ? preview.origin.fileName : file.name;

  return (
    <div className="dialog-backdrop">
      <section
        className="dialog-card source-dialog import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
      >
        <p className="coordinate-label">New sources · File import</p>
        <h2 id="import-title">Review import</h2>
        {preview === null ? (
          <p role="status">{converting ? `Converting ${file.name}…` : 'Preparing the import…'}</p>
        ) : (
          <>
            <p>
              {FORMAT_LABELS[preview.format]} · {originName} · {preview.entries.length}{' '}
              {preview.entries.length === 1 ? 'source' : 'sources'}
            </p>
            <ul className="conversion-notes" aria-label="Conversion notes">
              {preview.conversionNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
            <div className="import-entries">
              {preview.entries.map((entry, index) => (
                <fieldset key={index}>
                  <legend>Source {index + 1}</legend>
                  <label htmlFor={`import-source-title-${index}`}>Source title</label>
                  <input
                    id={`import-source-title-${index}`}
                    maxLength={300}
                    autoFocus={index === 0}
                    value={entry.title}
                    onChange={(event) => updateEntry(index, 'title', event.target.value)}
                  />
                  <label htmlFor={`import-source-content-${index}`}>Markdown content</label>
                  <textarea
                    id={`import-source-content-${index}`}
                    rows={10}
                    maxLength={10_485_760}
                    value={entry.markdown}
                    onChange={(event) => updateEntry(index, 'markdown', event.target.value)}
                  />
                </fieldset>
              ))}
            </div>
          </>
        )}
        {error === null ? null : <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <button ref={cancelRef} type="button" className="button-secondary" onClick={requestClose}>
            Cancel
          </button>
          {preview === null ? null : (
            <button
              type="button"
              className="button-primary"
              disabled={saving}
              onClick={() => void saveImport()}
            >
              {saving
                ? 'Saving…'
                : `Save ${preview.entries.length} ${preview.entries.length === 1 ? 'source' : 'sources'}`}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
