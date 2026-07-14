import type { Chat } from '@worldbookllm/shared';
import { useState } from 'react';

import { ApiClientError } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { useNotebookWorkspace } from '../notebooks/notebook-workspace-context.js';

interface SourceSelectorProps {
  chatId: string;
  selectedSourceIds: string[];
  onChatUpdated: (chat: Chat) => void;
}

/**
 * Edits the chat-owned source selection. The server contract is a complete
 * replacement of `sourceIds`, so every toggle sends the full remaining list.
 */
export function SourceSelector({ chatId, selectedSourceIds, onChatUpdated }: SourceSelectorProps) {
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

  async function toggle(sourceId: string) {
    if (saving || sourcesState.status !== 'ready') return;
    const next = new Set(selected);
    if (next.has(sourceId)) next.delete(sourceId);
    else next.add(sourceId);
    const sourceIds = sourcesState.sources
      .filter((source) => next.has(source.id))
      .map((source) => source.id);
    setSaving(true);
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
    }
  }

  return (
    <fieldset className="source-selector" disabled={saving}>
      <legend>Grounding sources</legend>
      {sources.length === 0 ? (
        <p className="empty-inline">No sources yet — paste one to ground this chat.</p>
      ) : (
        <>
          <p className="coordinate-label">
            {selected.size} of {sources.length} sources selected
          </p>
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
