import {
  SOURCE_ORGANIZATION_MAX_DRAFTS,
  type SourceCategory,
  type SourceMetadata,
} from '@worldbookllm/shared';
import { useMemo, useRef, useState } from 'react';

import { ApiClientError } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { useDialogLifecycle } from '../components/useDialogLifecycle.js';
import { useNotebookWorkspace } from '../notebooks/notebook-workspace-context.js';
import { SourceOrganizationFields } from './SourceOrganizationFields.js';
import { useExistingSourceOrganization } from './useSourceOrganization.js';

interface SourceOrganizeDialogProps {
  onClose: () => void;
}

interface ReviewRow {
  sourceId: string;
  category: SourceCategory | null;
  tags: string;
  organizationTouched: boolean;
}

function isUnorganized(source: SourceMetadata): boolean {
  return source.category === null && source.tags.length === 0;
}

function parseTags(tags: string): string[] {
  return tags
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '');
}

// Mirrors SourceService's write-time normalization (lowercase, capped
// length, case-insensitive dedupe) so the client's unchanged-row check
// agrees with what the server will actually persist — otherwise a saved
// row whose only local difference is casing looks changed forever and
// keeps getting re-sent on every retry.
function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.toLowerCase().slice(0, 50)))];
}

/**
 * Merges suggested tags into the source's saved tags: the user's existing
 * organization is never silently dropped by a bulk pass, suggestions only
 * extend it (case-insensitively deduplicated, within the persistence cap).
 */
function mergeTags(saved: string[], suggested: string[]): string[] {
  const merged = [...saved];
  for (const tag of suggested) {
    if (!merged.some((existing) => existing.toLowerCase() === tag.toLowerCase())) merged.push(tag);
  }
  return merged.slice(0, 20);
}

export function SourceOrganizeDialog({ onClose }: SourceOrganizeDialogProps) {
  const api = useApi();
  const { notebookId, sourcesState, updateSource } = useNotebookWorkspace();
  const organization = useExistingSourceOrganization(notebookId);
  const sources = useMemo(
    () => (sourcesState.status === 'ready' ? sourcesState.sources : []),
    [sourcesState],
  );
  const bySourceId = useMemo(
    () => new Map(sources.map((source) => [source.id, source])),
    [sources],
  );

  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(sources.filter(isUnorganized).map((source) => source.id)),
  );
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modified, setModified] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  function requestClose() {
    if (applying) return;
    if (modified && !window.confirm('Discard the reviewed organization?')) return;
    onClose();
  }

  useDialogLifecycle(cancelRef, requestClose);

  const overLimit = selected.size > SOURCE_ORGANIZATION_MAX_DRAFTS;

  function toggle(sourceId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(sourceId)) next.delete(sourceId);
      else next.add(sourceId);
      return next;
    });
  }

  function applySuggestions(result: NonNullable<typeof organization.response>) {
    const suggestions = new Map(
      result.suggestions.map((suggestion) => [suggestion.sourceId, suggestion]),
    );
    setRows((current) =>
      current === null
        ? current
        : current.map((row) => {
            if (row.organizationTouched) return row;
            const suggestion = suggestions.get(row.sourceId);
            const source = bySourceId.get(row.sourceId);
            if (suggestion === undefined || source === undefined) return row;
            return {
              ...row,
              category: suggestion.category ?? source.category,
              tags: mergeTags(source.tags, suggestion.tags).join(', '),
            };
          }),
    );
  }

  function beginReview() {
    const chosen = sources.filter((source) => selected.has(source.id));
    setRows(
      chosen.map((source) => ({
        sourceId: source.id,
        category: source.category,
        tags: source.tags.join(', '),
        organizationTouched: false,
      })),
    );
    setError(null);
    void organization.suggest(chosen.map((source) => source.id)).then((result) => {
      if (result !== null) applySuggestions(result);
    });
  }

  function updateRow(
    sourceId: string,
    update: { category: SourceCategory | null } | { tags: string },
  ) {
    setRows((current) =>
      current === null
        ? current
        : current.map((row) =>
            row.sourceId === sourceId ? { ...row, ...update, organizationTouched: true } : row,
          ),
    );
    setModified(true);
  }

  function suggestAgain(retrySourceId: string) {
    if (rows === null) return;
    // Only the retried row gives up its manual edits; every other touched
    // row keeps them when the new batch of suggestions lands.
    setRows((current) =>
      current === null
        ? current
        : current.map((row) =>
            row.sourceId === retrySourceId ? { ...row, organizationTouched: false } : row,
          ),
    );
    void organization.suggest(rows.map((row) => row.sourceId)).then((result) => {
      if (result !== null) applySuggestions(result);
    });
  }

  async function apply() {
    if (rows === null) return;
    setApplying(true);
    setError(null);
    const failures: string[] = [];
    for (const row of rows) {
      const source = bySourceId.get(row.sourceId);
      if (source === undefined) continue;
      const tags = normalizeTags(parseTags(row.tags));
      const unchanged =
        row.category === source.category && JSON.stringify(tags) === JSON.stringify(source.tags);
      if (unchanged) continue;
      try {
        const updated = await api.updateSource(row.sourceId, { category: row.category, tags });
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
      } catch (value) {
        failures.push(
          value instanceof ApiClientError ? `${source.title}: ${value.message}` : source.title,
        );
      }
    }
    setApplying(false);
    if (failures.length === 0) {
      setModified(false);
      onClose();
      return;
    }
    // Applied rows now match the refreshed workspace metadata, so retrying
    // Apply only re-sends the rows that failed.
    setError(
      `Could not organize ${failures.length === 1 ? 'this source' : 'these sources'}: ${failures.join('; ')}`,
    );
  }

  const reviewing = rows !== null;

  return (
    <div className="dialog-backdrop">
      <section
        className="dialog-card source-dialog organize-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="organize-title"
      >
        <p className="coordinate-label">Existing sources · Organization</p>
        <h2 id="organize-title">Organize sources</h2>
        {!reviewing ? (
          <>
            <p>
              Choose the sources to classify and tag with the notebook&apos;s model. Unorganized
              sources are preselected.
            </p>
            <div className="organize-select-actions">
              <button
                type="button"
                className="button-link"
                onClick={() => setSelected(new Set(sources.map((source) => source.id)))}
              >
                Select all
              </button>
              <button type="button" className="button-link" onClick={() => setSelected(new Set())}>
                Select none
              </button>
              <span aria-live="polite">
                {selected.size} of {sources.length} selected
              </span>
            </div>
            <ul className="organize-source-list">
              {sources.map((source) => (
                <li key={source.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={selected.has(source.id)}
                      onChange={() => toggle(source.id)}
                    />
                    <span className="source-title">{source.title}</span>
                    {source.category === null && source.tags.length === 0 ? null : (
                      <span className="source-meta coordinate-label">
                        {[
                          ...(source.category === null ? [] : [source.category]),
                          ...source.tags.map((tag) => `#${tag}`),
                        ].join(' · ')}
                      </span>
                    )}
                  </label>
                </li>
              ))}
            </ul>
            {overLimit ? (
              <p role="alert">
                Select up to {SOURCE_ORGANIZATION_MAX_DRAFTS} sources per organization pass.
              </p>
            ) : null}
          </>
        ) : (
          <div className="organize-review">
            {rows.map((row) => {
              const source = bySourceId.get(row.sourceId);
              if (source === undefined) return null;
              return (
                <fieldset key={row.sourceId}>
                  <legend>{source.title}</legend>
                  <SourceOrganizationFields
                    idPrefix={`organize-${row.sourceId}`}
                    labelSuffix={` for ${source.title}`}
                    category={row.category}
                    tags={row.tags}
                    loading={organization.loading}
                    warning={organization.response?.warning ?? null}
                    disabled={applying}
                    onCategoryChange={(category) => updateRow(row.sourceId, { category })}
                    onTagsChange={(tags) => updateRow(row.sourceId, { tags })}
                    onSuggestAgain={() => suggestAgain(row.sourceId)}
                  />
                </fieldset>
              );
            })}
          </div>
        )}
        {error === null ? null : <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <button
            ref={cancelRef}
            type="button"
            className="button-secondary"
            disabled={applying}
            onClick={requestClose}
          >
            Cancel
          </button>
          {!reviewing ? (
            <button
              type="button"
              className="button-primary"
              disabled={selected.size === 0 || overLimit}
              onClick={beginReview}
            >
              Suggest organization
            </button>
          ) : (
            <button
              type="button"
              className="button-primary"
              disabled={organization.loading || applying}
              onClick={() => void apply()}
            >
              {applying
                ? 'Applying…'
                : `Apply to ${rows.length} ${rows.length === 1 ? 'source' : 'sources'}`}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
