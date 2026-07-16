import type { Chat, SkillMetadata } from '@worldbookllm/shared';
import { useEffect, useRef, useState } from 'react';

import { ApiClientError } from '../api/client.js';
import { useApi } from '../api/useApi.js';

interface SkillSelectorProps {
  chatId: string;
  selectedSkillIds: string[];
  onChatUpdated: (chat: Chat) => void;
  /** Reports when a selection save is in flight so the panel can hold sends
   * until the persisted selection matches what the user sees. */
  onSavingChange?: (saving: boolean) => void;
}

type SkillsState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; skills: SkillMetadata[] };

/**
 * Edits the chat-owned skill selection. Skills are a global library (unlike
 * per-notebook sources), so the selector loads the list itself. The server
 * contract is a complete replacement of `skillIds`, so every toggle sends the
 * full remaining list.
 */
export function SkillSelector({
  chatId,
  selectedSkillIds,
  onChatUpdated,
  onSavingChange,
}: SkillSelectorProps) {
  const api = useApi();
  const [skillsState, setSkillsState] = useState<SkillsState>({ status: 'loading' });
  const [saving, setSaving] = useState(false);
  // Synchronous in-flight guard: `saving` state lags a render behind, so two
  // rapid toggles could otherwise both pass the check and race their PATCHes.
  const savingRef = useRef(false);
  // Selection shown while a PATCH is in flight, so the checkbox flips as
  // soon as it is clicked; a failed save falls back to the persisted list.
  const [optimistic, setOptimistic] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api
      .listSkills(controller.signal)
      .then((skills) => setSkillsState({ status: 'ready', skills }))
      .catch((caught: unknown) => {
        if (!(caught instanceof DOMException && caught.name === 'AbortError'))
          setSkillsState({ status: 'error' });
      });
    return () => controller.abort();
  }, [api]);

  if (skillsState.status !== 'ready' || skillsState.skills.length === 0) return null;
  const skills = skillsState.skills;
  const selected = new Set(optimistic ?? selectedSkillIds);

  async function persistSelection(skillIds: string[]) {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    onSavingChange?.(true);
    setOptimistic(skillIds);
    setError(null);
    try {
      onChatUpdated(await api.updateChat(chatId, { skillIds }));
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'Could not update the skills.');
    } finally {
      setOptimistic(null);
      savingRef.current = false;
      setSaving(false);
      onSavingChange?.(false);
    }
  }

  async function toggle(skillId: string) {
    const next = new Set(selected);
    if (next.has(skillId)) next.delete(skillId);
    else next.add(skillId);
    await persistSelection(skills.filter((skill) => next.has(skill.id)).map((skill) => skill.id));
  }

  return (
    <fieldset className="source-selector" disabled={saving}>
      <legend>Craft skills</legend>
      <div className="source-selector-heading">
        <p className="coordinate-label">
          {selected.size} of {skills.length} skills attached
        </p>
      </div>
      <ul className="source-selector-list">
        {skills.map((skill) => (
          <li key={skill.id}>
            <label title={skill.description}>
              <input
                type="checkbox"
                checked={selected.has(skill.id)}
                onChange={() => void toggle(skill.id)}
              />
              {skill.name}
            </label>
          </li>
        ))}
      </ul>
      {error === null ? null : <p role="alert">{error}</p>}
    </fieldset>
  );
}
