import type { AgentChat, PatchAgentChatInput } from '@worldbookllm/shared';
import { useState } from 'react';

import { useApi } from '../api/useApi.js';
import { errorMessage, useLoad } from '../books/useLoad.js';

interface AgentChatSettingsProps {
  chat: AgentChat;
  /** No changes while a turn runs; they apply from the next turn. */
  disabled: boolean;
  onChanged: (chat: AgentChat) => void;
}

/** Which agent a chat runs and whether its changes wait for review. */
export function AgentChatSettings({ chat, disabled, onChanged }: AgentChatSettingsProps) {
  const api = useApi();
  const agents = useLoad((signal) => api.listCustomAgents(signal), 'agents');
  const settings = useLoad((signal) => api.getAppSettings(signal), 'app-settings');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const globalReview = settings.status === 'ready' ? settings.data.agentReviewMode : false;
  const reviewing = chat.reviewMode ?? globalReview;

  async function patch(input: PatchAgentChatInput) {
    setBusy(true);
    setError(null);
    try {
      onChanged(await api.updateAgentChat(chat.id, input));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  const agentList = agents.status === 'ready' ? agents.data : [];
  const known = chat.agentId === null || agentList.some((agent) => agent.id === chat.agentId);

  return (
    <div className="agent-chat-settings">
      <label>
        <span className="coordinate-label">Agent</span>
        <select
          value={chat.agentId ?? ''}
          disabled={disabled || busy || agents.status !== 'ready'}
          onChange={(event) => void patch({ agentId: event.target.value || null })}
        >
          <option value="">Default agent</option>
          {agentList.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
          {known ? null : <option value={chat.agentId ?? ''}>Unknown agent</option>}
        </select>
      </label>
      <label className="agent-review-toggle">
        <input
          type="checkbox"
          checked={reviewing}
          disabled={disabled || busy || settings.status !== 'ready'}
          onChange={(event) => void patch({ reviewMode: event.target.checked })}
        />
        <span>
          Review changes before they apply
          {chat.reviewMode === null ? (
            <span className="coordinate-label"> · from Settings</span>
          ) : null}
        </span>
      </label>
      {error === null ? null : (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
