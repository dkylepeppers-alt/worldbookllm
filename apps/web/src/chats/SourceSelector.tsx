import type { Chat, SourceSearchResult } from '@worldbookllm/shared';
import { useEffect, useState } from 'react';

import { ApiClientError } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { useDebouncedValue } from '../hooks/useDebouncedValue.js';
import { useNotebookWorkspace } from '../notebooks/notebook-workspace-context.js';

interface SourceSelectorProps {
  chatId: string;
  selectedSourceIds: string[];
  onChatUpdated: (chat: Chat) => void;
  /** Reports when a selection save is in flight so the panel can hold sends
   * until the persisted selection matches what the user sees. */
  onSavingChange?: (saving: boolean) => void;
}

/**
 * Edits the chat-owned source selection. The server contract is a complete
 * replacement of `sourceIds`, so every toggle sends the full remaining list.
 * A search box narrows the visible checkboxes via full-text search without
 * touching hidden selections: toggles always rebuild the complete id list
 * from the workspace's sources, so off-screen picks are preserved.
 */
export function SourceSelector({
  chatId,
  selectedSourceIds,
  onChatUpdated,
  onSavingChange,
}: SourceSelectorProps) {
  const api = useApi();
  const { notebookId, sourcesState } = useNotebookWorkspace();
  const [saving, setSaving] = useState(false);
  // Selection shown while a PATCH is in flight, so the checkbox flips as
  // soon as it is clicked; a failed save falls back to the persisted list.
  const [optimistic, setOptimistic] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  // The last completed search; null results mean the request failed.
  const [completed, setCompleted] = useState<{
    query: string;
    results: SourceSearchResult[] | null;
  } | null>(null);
  const debouncedQuery = useDebouncedValue(query.trim(), 250);

  useEffect(() => {
    if (debouncedQuery === '') return;
    const controller = new AbortController();
    api
      .searchSources(notebookId, debouncedQuery, controller.signal)
      .then((results) => setCompleted({ query: debouncedQuery, results }))
      .catch(() => {
        if (!controller.signal.aborted) setCompleted({ query: debouncedQuery, results: null });
      });
    return () => controller.abort();
  }, [api, notebookId, debouncedQuery]);

  if (sourcesState.status !== 'ready') return null;
  const sources = sourcesState.sources;
  const selected = new Set(optimistic ?? selectedSourceIds);
  const allSelected = sources.length > 0 && selected.size === sources.length;

  const searching = query.trim() !== '';
  // Only a completed search for the query currently in the box counts —
  // anything else is treated as in flight, so stale results never narrow
  // the list.
  const current =
    searching && completed !== null && completed.query === query.trim() ? completed : null;
  const searchFailed = current !== null && current.results === null;
  const resultIds =
    current !== null && current.results !== null
      ? new Set(current.results.map((result) => result.id))
      : null;
  const visibleSources =
    resultIds === null
      ? searching
        ? []
        : sources
      : sources.filter((source) => resultIds.has(source.id));

  // Persists a complete selection in a single PATCH. Individual toggles and the
  // bulk Select all / Clear all actions all route through here.
  async function persistSelection(sourceIds: string[]) {
    if (saving || sourcesState.status !== 'ready') return;
    setSaving(true);
    onSavingChange?.(true);
    setOptimistic(sourceIds);
    setError(null);
    try {
      onChatUpdated(await api.updateChat(chatId, { sourceIds }));
    } catch (caught) {
      setError(
        caught instanceof ApiClientError ? caught.message : 'Could not update the selection.',
      );
    } finally {
      setOptimistic(null);
      setSaving(false);
      onSavingChange?.(false);
    }
  }

  async function toggle(sourceId: string) {
    if (sourcesState.status !== 'ready') return;
    const next = new Set(selected);
    if (next.has(sourceId)) next.delete(sourceId);
    else next.add(sourceId);
    await persistSelection(
      sourcesState.sources.filter((source) => next.has(source.id)).map((source) => source.id),
    );
  }

  return (
    <fieldset className="source-selector" disabled={saving}>
      <legend>Grounding sources</legend>
      {sources.length === 0 ? (
        <p className="empty-inline">No sources yet — paste one to ground this chat.</p>
      ) : (
        <>
          <div className="source-selector-heading">
            <p className="coordinate-label">
              {selected.size} of {sources.length} sources selected
            </p>
            <div className="source-selector-bulk">
              <button
                type="button"
                disabled={saving || allSelected}
                onClick={() => void persistSelection(sources.map((source) => source.id))}
              >
                Select all
              </button>
              <button
                type="button"
                disabled={saving || selected.size === 0}
                onClick={() => void persistSelection([])}
              >
                Clear all
              </button>
            </div>
          </div>
          <div className="source-selector-search">
            <input
              type="search"
              aria-label="Search sources to select"
              placeholder="Search sources to select"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {searching && visibleSources.length > 0 ? (
              <button
                type="button"
                disabled={saving || visibleSources.every((source) => selected.has(source.id))}
                onClick={() =>
                  void persistSelection(
                    sources
                      .filter(
                        (source) =>
                          selected.has(source.id) ||
                          visibleSources.some((visible) => visible.id === source.id),
                      )
                      .map((source) => source.id),
                  )
                }
              >
                Select results
              </button>
            ) : null}
          </div>
          {searchFailed ? (
            <p className="empty-inline">The notebook could not be searched — try again.</p>
          ) : searching && resultIds !== null && visibleSources.length === 0 ? (
            <p className="empty-inline">No sources match this search.</p>
          ) : (
            <ul className="source-selector-list">
              {visibleSources.map((source) => (
                <li key={source.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={selected.has(source.id)}
                      onChange={() => void toggle(source.id)}
                    />
                    {source.title}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {error === null ? null : <p role="alert">{error}</p>}
    </fieldset>
  );
}
