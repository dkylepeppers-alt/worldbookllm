import type { JsonImportPreview } from '@worldbookllm/shared';
import { type ChangeEvent, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ApiClientError } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { useDialogLifecycle } from '../components/useDialogLifecycle.js';
import { useNotebookWorkspace } from '../notebooks/notebook-workspace-context.js';

interface SourceJsonImportDialogProps {
  onClose: () => void;
}

export function SourceJsonImportDialog({ onClose }: SourceJsonImportDialogProps) {
  const api = useApi();
  const navigate = useNavigate();
  const { notebookId, addSource, setLastSourceId } = useNotebookWorkspace();
  const [preview, setPreview] = useState<JsonImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modified, setModified] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function requestClose() {
    if (modified && !window.confirm('Discard your changes to this import?')) return;
    onClose();
  }

  useDialogLifecycle(fileRef, requestClose);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file === undefined) return;
    setConverting(true);
    setError(null);
    try {
      setPreview(await api.previewJsonImport(notebookId, file));
      setModified(false);
    } catch (value) {
      setError(value instanceof ApiClientError ? value.message : 'Could not read the JSON import.');
    } finally {
      setConverting(false);
      event.target.value = '';
    }
  }

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
    if (preview.entries.some((entry) => entry.title.trim() === '' || entry.markdown.trim() === '')) {
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
          origin: {
            type: 'file' as const,
            fileName: preview.fileName,
            mediaType: 'application/json',
          },
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

  const dialogTitle = preview === null ? 'Import SillyTavern JSON' : 'Review JSON import';

  return (
    <div className="dialog-backdrop">
      <section
        className="dialog-card source-dialog json-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="json-import-title"
      >
        <p className="coordinate-label">New sources · JSON import</p>
        <h2 id="json-import-title">{dialogTitle}</h2>
        {preview === null ? (
          <>
            <p>
              Choose a SillyTavern lorebook or character card. Lorebook entries become separate
              sources; card metadata is left behind.
            </p>
            <label htmlFor="json-import-file">JSON file</label>
            <input
              ref={fileRef}
              id="json-import-file"
              type="file"
              accept=".json,application/json"
              disabled={converting}
              onChange={(event) => void handleFile(event)}
            />
            {converting ? <p role="status">Extracting source material…</p> : null}
          </>
        ) : (
          <>
            <p>
              {preview.format === 'lorebook' ? 'Lorebook' : 'Character card'} · {preview.fileName} ·{' '}
              {preview.entries.length} {preview.entries.length === 1 ? 'source' : 'sources'}
            </p>
            <ul className="conversion-notes" aria-label="Conversion notes">
              {preview.conversionNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
            <div className="json-import-entries">
              {preview.entries.map((entry, index) => (
                <fieldset key={index}>
                  <legend>Source {index + 1}</legend>
                  <label htmlFor={`json-source-title-${index}`}>Source title</label>
                  <input
                    id={`json-source-title-${index}`}
                    maxLength={300}
                    value={entry.title}
                    onChange={(event) => updateEntry(index, 'title', event.target.value)}
                  />
                  <label htmlFor={`json-source-content-${index}`}>Markdown content</label>
                  <textarea
                    id={`json-source-content-${index}`}
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
          <button type="button" className="button-secondary" onClick={requestClose}>
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
