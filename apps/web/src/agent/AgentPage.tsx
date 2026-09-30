import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { useApi } from '../api/useApi.js';
import { useBook } from '../books/book-context.js';
import { errorMessage, useLoad } from '../books/useLoad.js';
import { ErrorState, LoadingState } from '../components/RequestState.js';
import { AgentComposer } from './AgentComposer.js';
import { useAgentRunner } from './agent-runner-context.js';
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
 * `?about=<path>` (from a file's "Ask the agent") names that file in the draft.
 */
export function AgentPage() {
  const api = useApi();
  const navigate = useNavigate();
  const runner = useAgentRunner();
  const { slug } = useBook();
  const [params] = useSearchParams();
  const about = params.get('about');
  const chats = useLoad((signal) => api.listAgentChats(slug, signal), slug);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = runner.run !== null;

  async function start(content: string): Promise<'accepted' | 'rejected'> {
    setCreating(true);
    setError(null);
    try {
      const chat = await api.createAgentChat(slug);
      void runner.send(chat.id, content);
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
        listed with diffs and can be undone.
      </p>
      <SkillsNotice />
      {error === null ? null : (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <AgentComposer
        id="agent-new-chat-input"
        label={about === null ? 'New chat' : `New chat about ${about}`}
        initialDraft={about === null ? '' : `About ${about}: `}
        submitLabel="Start chat"
        running={running}
        busy={creating}
        onSend={start}
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
