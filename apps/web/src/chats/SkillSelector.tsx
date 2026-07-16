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
  // Each acquisition of the parent send-hold gets a token, and only the
  // holder of the *current* token may release it. Without this, a stale save
  // (from before a chat switch) settling late would clear the hold a newer
  // save legitimately owns, re-enabling sends too early.
  const holdCounterRef = useRef(0);
  const activeHoldRef = useRef<number | null>(null);
  // Selection shown while a PATCH is in flight, so the checkbox flips as
  // soon as it is clicked; a failed save falls back to the persisted list.
  const [optimistic, setOptimistic] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listReload, setListReload] = useState(0);

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
  }, [api, listReload]);

  function acquireHold(): number {
    const token = ++holdCounterRef.current;
    activeHoldRef.current = token;
    onSavingChange?.(true);
    return token;
  }

  function releaseHold(token: number) {
    if (token !== activeHoldRef.current) return;
    activeHoldRef.current = null;
    onSavingChange?.(false);
  }

  // If the selector unmounts (e.g. the user switches chats) while a PATCH is
  // still pending, release the parent's send-hold — otherwise a request that
  // never settles would keep the composer disabled in every later chat. The
  // settled request's own release then no-ops on its stale token.
  useEffect(
    () => () => {
      if (activeHoldRef.current !== null) {
        activeHoldRef.current = null;
        onSavingChange?.(false);
      }
    },
    [onSavingChange],
  );

  // Loading and failure are only worth surfacing when this chat has attached
  // skills the user cannot currently see or repair.
  if (skillsState.status === 'loading') {
    return selectedSkillIds.length === 0 ? null : (
      <fieldset className="source-selector" disabled>
        <legend>Craft skills</legend>
        <p className="empty-inline">Loading attached skills…</p>
      </fieldset>
    );
  }
  if (skillsState.status === 'error') {
    return (
      <fieldset className="source-selector">
        <legend>Craft skills</legend>
        <p role="alert">The skills library could not be loaded.</p>
        <button type="button" onClick={() => setListReload((value) => value + 1)}>
          Retry
        </button>
      </fieldset>
    );
  }
  if (skillsState.skills.length === 0) return null;
  const skills = skillsState.skills;
  const selected = new Set(optimistic ?? selectedSkillIds);

  async function persistSelection(skillIds: string[]) {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    const hold = acquireHold();
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
      releaseHold(hold);
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
