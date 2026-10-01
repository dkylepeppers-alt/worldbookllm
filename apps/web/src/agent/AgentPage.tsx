import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { useApi } from '../api/useApi.js';
import { useBook } from '../books/book-context.js';
import { errorMessage, useLoad } from '../books/useLoad.js';
import { ErrorState, LoadingState } from '../components/RequestState.js';
import { AgentComposer } from './AgentComposer.js';
import { useAgentRunner } from './agent-runner-context.js';
import { useDraftAppend } from './use-draft-append.js';
import { StoryCommandsPanel } from './StoryCommandsPanel.js';
import { StorySkillsInstall } from './StorySkillsInstall.js';

function formatChatTime(value: string): string {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

/** Offers the story-skills craft skills when none are installed yet. */
function SkillsNotice() {
  const api = useApi();
  const skills = useLoad((signal) => api.listSkills(signal), 'skills');
  const [installed, setInstalled] = useState(false);
  if (skills.status !== 'ready') return null;
  // Once installed here, the notice stays to show the report, without the button.
  if (!installed && skills.data.some((skill) => skill.origin.type === 'story-skills')) return null;
  return (
    <section className="agent-notice" aria-label="Story Skills">
      <p className="coordinate-label">Craft skills</p>
      <p>
        The agent plans, drafts, and checks by following the story-skills craft skills. Install them
        into your skills library to give it the full set.
      </p>
      <StorySkillsInstall once onInstalled={() => setInstalled(true)} />
    </section>
  );
}

/**
 * The Agent tab: start a chat with the agent about this book, or reopen one.
 * `?about=<path>` (from a file's "Ask the agent") pins that file: its current
 * contents go to the model with the first message.
 */
export function AgentPage() {
  const api = useApi();
  const navigate = useNavigate();
  const runner = useAgentRunner();
  const { slug } = useBook();
  const [params] = useSearchParams();
  const about = params.get('about');
  const [unpinned, setUnpinned] = useState<string | null>(null);
  const pinned = about !== null && unpinned !== about ? [about] : [];
  const chats = useLoad((signal) => api.listAgentChats(slug, signal), slug);
  const agents = useLoad((signal) => api.listCustomAgents(signal), 'agents');
  const settings = useLoad((signal) => api.getAppSettings(signal), 'app-settings');
  const [agentId, setAgentId] = useState('');
  // null follows the global review-mode setting; a choice here overrides it for the chat.
  const [review, setReview] = useState<boolean | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draft = useDraftAppend('agent-new-chat-input');
  const running = runner.run !== null;
  const agentList = agents.status === 'ready' ? agents.data : [];
  const agentNames = new Map(agentList.map((agent) => [agent.id, agent.name]));
  const globalReview = settings.status === 'ready' ? settings.data.agentReviewMode : false;

  async function start(content: string): Promise<'accepted' | 'rejected'> {
    setCreating(true);
    setError(null);
    try {
      const chat = await api.createAgentChat(slug, {
        ...(agentId === '' ? {} : { agentId }),
        ...(review === null ? {} : { reviewMode: review }),
      });
      void runner.send(chat.id, content, pinned);
      await navigate(`/books/${encodeURIComponent(slug)}/agent/${chat.id}`);
      return 'accepted';
    } catch (caught) {
      setError(errorMessage(caught));
      setCreating(false);
      return 'rejected';
    }
  }

  return (
    <section className="book-panel agent-panel" aria-labelledby="agent-heading">
      <p className="coordinate-label">{slug} · agent</p>
      <h2 id="agent-heading">Agent</h2>
      <p className="agent-intro">
        The agent reads and edits this book's files with the story CLI. Each turn's changes are
        listed with diffs and can be undone, or held for your review first.
      </p>
      <SkillsNotice />
      {error === null ? null : (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="agent-chat-settings">
        <label>
          <span className="coordinate-label">Agent</span>
          <select value={agentId} onChange={(event) => setAgentId(event.target.value)}>
            <option value="">Default agent</option>
            {agentList.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </label>
        <Link className="coordinate-label" to="/agents">
          Manage agents
        </Link>
        <label className="agent-review-toggle">
          <input
            type="checkbox"
            checked={review ?? globalReview}
            disabled={settings.status !== 'ready'}
            onChange={(event) => setReview(event.target.checked)}
          />
          <span>Review changes before they apply</span>
        </label>
      </div>
      {pinned.length === 0 ? null : (
        <p className="pinned-files">
          <span className="coordinate-label">Pinned file: {pinned.join(', ')}</span>{' '}
          <button type="button" className="text-button" onClick={() => setUnpinned(about)}>
            Unpin
          </button>
        </p>
      )}
      <StoryCommandsPanel onAsk={draft.ask} />
      <AgentComposer
        id="agent-new-chat-input"
        label={pinned.length === 0 ? 'New chat' : `New chat about ${pinned.join(', ')}`}
        submitLabel="Start chat"
        running={running}
        busy={creating}
        onSend={start}
        append={draft.append}
      />
      {running ? (
        <p className="change-note">
          The agent is working in{' '}
          <Link to={`/books/${encodeURIComponent(slug)}/agent/${runner.run?.chatId ?? ''}`}>
            another chat
          </Link>
          . Start a new one when it finishes.
        </p>
      ) : null}

      <h3>Chats</h3>
      {chats.status === 'loading' ? <LoadingState>Reading chats…</LoadingState> : null}
      {chats.status === 'error' ? (
        <ErrorState title="Chats could not load" message={chats.message} onRetry={chats.reload} />
      ) : null}
      {chats.status === 'ready' ? (
        chats.data.length === 0 ? (
          <p className="empty-map">No chats with the agent yet.</p>
        ) : (
          <ul className="entry-list" aria-label="Agent chats">
            {chats.data.map((chat) => (
              <li key={chat.id}>
                <Link to={`/books/${encodeURIComponent(slug)}/agent/${chat.id}`}>{chat.title}</Link>
                <span className="coordinate-label">
                  {formatChatTime(chat.updatedAt)}
                  {chat.agentId === null ? '' : ` · ${agentNames.get(chat.agentId) ?? 'agent'}`}
                  {runner.run?.chatId === chat.id ? ' · working' : ''}
                </span>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </section>
  );
}
