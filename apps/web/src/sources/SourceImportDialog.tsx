import {
  SOURCE_ORGANIZATION_MAX_CONTENT,
  SOURCE_ORGANIZATION_MAX_DRAFTS,
  type SourceCategory,
  type SourcePreview,
  type SourcePreviewFormat,
} from '@worldbookllm/shared';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ApiClientError } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { useDialogLifecycle } from '../components/useDialogLifecycle.js';
import { useNotebookWorkspace } from '../notebooks/notebook-workspace-context.js';
import { SourceOrganizationFields } from './SourceOrganizationFields.js';
import { useSourceOrganization } from './useSourceOrganization.js';

interface SourceImportDialogProps {
  file: File;
  onClose: () => void;
}

type OrganizedPreviewEntry = SourcePreview['entries'][number] & {
  category: SourceCategory | null;
  tags: string;
  organizationTouched: boolean;
};

const ORGANIZATION_WARNING = "Couldn't suggest organization. You can choose it manually.";

function withinSuggestionBounds(entries: { markdown: string }[]): boolean {
  return (
    entries.length <= SOURCE_ORGANIZATION_MAX_DRAFTS &&
    entries.reduce((total, entry) => total + entry.markdown.length, 0) <=
      SOURCE_ORGANIZATION_MAX_CONTENT
  );
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
  const organization = useSourceOrganization(notebookId);
  const { loading: organizationLoading, response: organizationResponse, suggest } = organization;
  const [preview, setPreview] = useState<SourcePreview | null>(null);
  const [entries, setEntries] = useState<OrganizedPreviewEntry[]>([]);
  const [organizationWarning, setOrganizationWarning] = useState<string | null>(null);
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
        const organizedEntries = result.entries.map((entry) => ({
          ...entry,
          category: null,
          tags: '',
          organizationTouched: false,
        }));
        setPreview(result);
        setEntries(organizedEntries);
        setModified(false);
        if (!withinSuggestionBounds(result.entries)) {
          setOrganizationWarning(ORGANIZATION_WARNING);
          return;
        }
        setOrganizationWarning(null);
        void suggest(
          result.entries.map((entry, index) => ({
            index,
            title: entry.title,
            content: entry.markdown,
          })),
        ).then((resultOrganization) => {
          if (resultOrganization === null) return;
          setEntries((current) =>
            current.map((entry, index) => {
              if (entry.organizationTouched) return entry;
              const suggestion = resultOrganization.suggestions.find(
                (item) => item.index === index,
              );
              return suggestion === undefined
                ? entry
                : {
                    ...entry,
                    category: suggestion.category,
                    tags: suggestion.tags.join(', '),
                  };
            }),
          );
        });
      })
      .catch((value: unknown) => {
        if (value instanceof DOMException && value.name === 'AbortError') return;
        setError(
          value instanceof ApiClientError ? value.message : 'Could not read the imported file.',
        );
      })
      .finally(() => setConverting(false));
    return () => controller.abort();
  }, [api, file, notebookId, suggest]);

  function updateEntry(index: number, field: 'title' | 'markdown', value: string) {
    setEntries((current) =>
      current.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, [field]: value } : entry,
      ),
    );
    setModified(true);
  }

  function updateOrganization(
    index: number,
    update: { category: SourceCategory | null } | { tags: string },
  ) {
    setEntries((current) =>
      current.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, ...update, organizationTouched: true } : entry,
      ),
    );
    setModified(true);
  }

  function suggestAgain(retryIndex: number) {
    if (!withinSuggestionBounds(entries)) {
      setOrganizationWarning(ORGANIZATION_WARNING);
      return;
    }
    setOrganizationWarning(null);
    // Only the retried entry gives up its manual edits; every other touched
    // entry keeps them when the new batch of suggestions lands.
    setEntries((current) =>
      current.map((entry, index) =>
        index === retryIndex ? { ...entry, organizationTouched: false } : entry,
      ),
    );
    void suggest(
      entries.map((entry, index) => ({
        index,
        title: entry.title,
        content: entry.markdown,
      })),
    ).then((result) => {
      if (result === null) return;
      setEntries((current) =>
        current.map((entry, index) => {
          if (entry.organizationTouched) return entry;
          const suggestion = result.suggestions.find((item) => item.index === index);
          return suggestion === undefined
            ? entry
            : {
                ...entry,
                category: suggestion.category,
                tags: suggestion.tags.join(', '),
              };
        }),
      );
    });
  }

  async function saveImport() {
    if (preview === null) return;
    if (entries.some((entry) => entry.title.trim() === '' || entry.markdown.trim() === '')) {
      setError('Every imported source needs a title and Markdown content.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await api.createSources(
        notebookId,
        entries.map((entry) => ({
          title: entry.title.trim(),
          content: entry.markdown,
          origin: preview.origin,
          conversionNotes: preview.conversionNotes,
          category: entry.category,
          tags: entry.tags
            .split(',')
            .map((tag) => tag.trim())
            .filter((tag) => tag !== ''),
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
              {FORMAT_LABELS[preview.format]} · {originName} · {entries.length}{' '}
              {entries.length === 1 ? 'source' : 'sources'}
            </p>
            <ul className="conversion-notes" aria-label="Conversion notes">
              {preview.conversionNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
            <div className="import-entries">
              {entries.map((entry, index) => (
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
                  <SourceOrganizationFields
                    idPrefix={`import-source-${index}`}
                    labelSuffix={` for Source ${index + 1}`}
                    category={entry.category}
                    tags={entry.tags}
                    loading={organizationLoading}
                    warning={organizationWarning ?? organizationResponse?.warning ?? null}
                    disabled={saving}
                    onCategoryChange={(category) => updateOrganization(index, { category })}
                    onTagsChange={(tags) => updateOrganization(index, { tags })}
                    onSuggestAgain={() => suggestAgain(index)}
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
              disabled={organizationLoading || saving}
              onClick={() => void saveImport()}
            >
              {saving
                ? 'Saving…'
                : `Save ${entries.length} ${entries.length === 1 ? 'source' : 'sources'}`}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
