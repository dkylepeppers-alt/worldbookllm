import type { Chat } from '@worldbookllm/shared';
import { useState } from 'react';

import { ApiClientError } from '../api/client.js';
import { useApi } from '../api/useApi.js';
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
 */
export function SourceSelector({
  chatId,
  selectedSourceIds,
  onChatUpdated,
  onSavingChange,
}: SourceSelectorProps) {
  const api = useApi();
  const { sourcesState } = useNotebookWorkspace();
  const [saving, setSaving] = useState(false);
  // Selection shown while a PATCH is in flight, so the checkbox flips as
  // soon as it is clicked; a failed save falls back to the persisted list.
  const [optimistic, setOptimistic] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (sourcesState.status !== 'ready') return null;
  const sources = sourcesState.sources;
  const selected = new Set(optimistic ?? selectedSourceIds);
  const allSelected = sources.length > 0 && selected.size === sources.length;

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
          <ul className="source-selector-list">
            {sources.map((source) => (
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
        </>
      )}
      {error === null ? null : <p role="alert">{error}</p>}
    </fieldset>
  );
}
