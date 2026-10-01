import type {
  AgentChangeset,
  AgentChat,
  AgentChatDetail,
  AgentMessage,
  Checkpoint,
} from '@worldbookllm/shared';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { ApiClientError } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { useBook } from '../books/book-context.js';
import { errorMessage, useLoad } from '../books/useLoad.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { ErrorState, LoadingState } from '../components/RequestState.js';
import { AgentComposer } from './AgentComposer.js';
import { AgentInspectorDialog } from './AgentInspectorDialog.js';
import { AgentMessages } from './AgentMessages.js';
import { useAgentRunner } from './agent-runner-context.js';
import { useDraftAppend } from './use-draft-append.js';
import { AgentChatSettings } from './AgentChatSettings.js';
import { DiffDialog, type DiffFile } from './DiffDialog.js';
import { StoryCommandsPanel } from './StoryCommandsPanel.js';

const WATCH_POLL_MS = 2000;

interface DiffTarget {
  label: string;
  files: ReadonlyArray<Pick<Checkpoint['files'][number], 'path' | 'change'>>;
  path: string;
  loadKey: string;
  load: (signal: AbortSignal) => Promise<readonly DiffFile[]>;
  canOpen: (path: string) => boolean;
}

/** The later of two snapshots of the same chat. */
function newer(left: AgentChatDetail, right: AgentChatDetail | null): AgentChatDetail {
  if (right === null || right.id !== left.id) return left;
  if (right.messages.length !== left.messages.length) {
    return right.messages.length > left.messages.length ? right : left;
  }
  const leftLast = left.messages.at(-1)?.updatedAt ?? '';
  const rightLast = right.messages.at(-1)?.updatedAt ?? '';
  return rightLast > leftLast ? right : left;
}

/**
 * While this screen streams a turn, the pending view stands in for the rows
 * the server already stored for it: the user message and the assistant
 * message still marked streaming.
 */
function withoutRunningTurn(messages: AgentMessage[]): AgentMessage[] {
  const index = messages.findIndex((message) => message.status === 'streaming');
  if (index === -1) return messages;
  const start = index > 0 && messages[index - 1]?.role === 'user' ? index - 1 : index;
  return messages.slice(0, start);
}

export function AgentChatRoute() {
  const chatId = useParams().chatId ?? '';
  return <AgentChatPage key={chatId} chatId={chatId} />;
}

/** One agent chat: the conversation, its per-turn changes with undo, and the composer. */
function AgentChatPage({ chatId }: { chatId: string }) {
  const api = useApi();
  const navigate = useNavigate();
  const runner = useAgentRunner();
  const { slug, tree, reload: reloadTree } = useBook();
  const loaded = useLoad((signal) => api.getAgentChat(chatId, signal), chatId);
  const history = useLoad(
    (signal) => api.listCheckpoints(slug, signal),
    `${slug}:${runner.checkpoint?.id ?? ''}:${tree.files.map((file) => file.hash).join()}`,
  );
  const [inspecting, setInspecting] = useState<AgentMessage | null>(null);
  const [diff, setDiff] = useState<DiffTarget | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);
  const [settings, setSettings] = useState<AgentChat | null>(null);
  const [resolved, setResolved] = useState<ReadonlyMap<string, AgentChangeset>>(new Map());
  const [resolving, setResolving] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const draft = useDraftAppend('agent-message-input');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [older, setOlder] = useState<ReadonlyMap<string, Checkpoint>>(new Map());
  // The watched turn's assistant message this screen asked the server to stop.
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [stopError, setStopError] = useState<string | null>(null);

  const run = runner.run?.chatId === chatId ? runner.run : null;
  const chat = loaded.status === 'ready' ? newer(loaded.data, runner.settled) : null;
  // A turn running without this screen's stream (started before a reload,
  // or from another device) is watched until the server settles it.
  const watching = run === null && chat?.messages.at(-1)?.status === 'streaming';
  const reloadChat = loaded.reload;
  const watchedId = watching ? (chat?.messages.at(-1)?.id ?? null) : null;

  async function stopWatched() {
    if (watchedId === null) return;
    setStoppingId(watchedId);
    setStopError(null);
    try {
      await api.stopAgentChat(chatId);
    } catch (caught) {
      // Already finished: the next reload shows how it ended.
      if (!(caught instanceof ApiClientError && caught.status === 409)) {
        setStoppingId(null);
        setStopError(errorMessage(caught));
      }
    }
    reloadChat();
  }
  useEffect(() => {
    if (!watching) return;
    const timer = setTimeout(reloadChat, WATCH_POLL_MS);
    return () => clearTimeout(timer);
  }, [watching, reloadChat, chat]);

  const checkpoints = new Map<string, Checkpoint>(older);
  if (runner.checkpoint !== null) checkpoints.set(runner.checkpoint.id, runner.checkpoint);
  if (history.status === 'ready') {
    for (const checkpoint of history.data) checkpoints.set(checkpoint.id, checkpoint);
  }
  // The history lists only the book's newest checkpoints; turns older than
  // that fetch their own so they keep their change summary and diffs.
  const missing =
    history.status === 'ready' && chat !== null && chat.book === slug
      ? [
          ...new Set(
            chat.messages.flatMap((message) =>
              message.checkpointId !== null &&
              message.status !== 'streaming' &&
              !checkpoints.has(message.checkpointId)
                ? [message.checkpointId]
                : [],
            ),
          ),
        ]
      : [];
  const missingKey = missing.join();
  useEffect(() => {
    if (missingKey === '') return;
    const controller = new AbortController();
    void Promise.allSettled(
      missingKey.split(',').map((id) => api.getCheckpoint(slug, id, controller.signal)),
    ).then((results) => {
      if (controller.signal.aborted) return;
      setOlder((current) => {
        const next = new Map(current);
        for (const result of results) {
          if (result.status !== 'fulfilled') continue;
          const { files, ...rest } = result.value;
          next.set(rest.id, {
            ...rest,
            files: files.map(({ path, change }) => ({ path, change })),
          });
        }
        return next;
      });
    });
    return () => controller.abort();
  }, [api, slug, missingKey]);
  const latestLiveId =
    history.status === 'ready'
      ? (history.data.find((checkpoint) => checkpoint.undoneAt === null)?.id ?? null)
      : null;

  async function undo(checkpoint: Checkpoint) {
    setUndoing(true);
    setUndoError(null);
    try {
      await api.undoCheckpoint(slug, checkpoint.id);
      reloadTree();
      history.reload();
    } catch (caught) {
      setUndoError(errorMessage(caught));
    } finally {
      setUndoing(false);
    }
  }

  // Review mode: the latest known state of each changeset, by the message that proposed it.
  const changesets = new Map<string, AgentChangeset>();
  for (const changeset of chat?.changesets ?? []) {
    changesets.set(changeset.messageId, resolved.get(changeset.id) ?? changeset);
  }

  async function resolve(changeset: AgentChangeset, action: 'apply' | 'skip', path?: string) {
    setResolving(`${changeset.id}:${path ?? '*'}`);
    setUndoError(null);
    try {
      const result = await api.resolveAgentChangeset(
        changeset.id,
        action,
        path === undefined ? undefined : [path],
      );
      setResolved((current) => new Map(current).set(changeset.id, result.changeset));
      if (result.checkpoint !== null) reloadTree();
    } catch (caught) {
      setUndoError(errorMessage(caught));
    } finally {
      setResolving(null);
    }
  }

  // "Open file" only for files the book has now: a later undo, edit, or
  // removal can take away a file a change once created.
  const inBook = (path: string) => tree.files.some((file) => file.path === path);

  function openCheckpoint(checkpoint: Checkpoint, path: string) {
    setDiff({
      label: checkpoint.label,
      files: checkpoint.files,
      path,
      loadKey: `checkpoint:${checkpoint.id}`,
      load: (signal) =>
        api.getCheckpoint(slug, checkpoint.id, signal).then((detail) => detail.files),
      canOpen: (target) => checkpoint.undoneAt === null && inBook(target),
    });
  }

  function openProposal(changeset: AgentChangeset, path: string) {
    setDiff({
      label: 'Proposed by the agent',
      files: changeset.files,
      path,
      loadKey: `changeset:${changeset.id}`,
      load: (signal) => api.getAgentChangeset(changeset.id, signal).then((detail) => detail.files),
      canOpen: (target) =>
        changeset.files.find((entry) => entry.path === target)?.status === 'applied' &&
        inBook(target),
    });
  }

  async function remove() {
    setDeleteBusy(true);
    try {
      await api.deleteAgentChat(chatId);
      await navigate(`/books/${encodeURIComponent(slug)}/agent`);
    } catch (caught) {
      setUndoError(errorMessage(caught));
      setDeleteBusy(false);
      setDeleting(false);
    }
  }

  if (loaded.status === 'loading') return <LoadingState>Opening the chat…</LoadingState>;
  if (loaded.status === 'error' || chat === null) {
    return (
      <ErrorState
        title="This chat could not open"
        message={loaded.status === 'error' ? loaded.message : ''}
        onRetry={loaded.reload}
      />
    );
  }

  if (chat.book !== slug) {
    return (
      <ErrorState
        title="This chat belongs to another book"
        message={`Open it from the book it was started in (${chat.book}).`}
      />
    );
  }

  const error = runner.error?.chatId === chatId ? runner.error : null;
  const busyElsewhere = runner.run !== null && run === null;

  return (
    <section className="book-panel agent-chat" aria-labelledby="agent-chat-title">
      <header className="agent-chat-header">
        <Link className="coordinate-label" to={`/books/${encodeURIComponent(slug)}/agent`}>
          ← Chats
        </Link>
        <h2 id="agent-chat-title">{chat.title}</h2>
        <AgentChatSettings
          chat={settings?.id === chat.id ? settings : chat}
          disabled={run !== null || watching}
          onChanged={setSettings}
        />
      </header>

      {chat.messages.length === 0 && run === null ? (
        <p className="empty-map">Ask the agent to plan, draft, revise, or check this book.</p>
      ) : (
        <AgentMessages
          messages={run === null ? chat.messages : withoutRunningTurn(chat.messages)}
          pending={run?.turn ?? null}
          checkpoints={checkpoints}
          latestLiveId={latestLiveId}
          undoing={undoing}
          changesets={changesets}
          resolving={resolving}
          onInspect={setInspecting}
          onOpenDiff={openCheckpoint}
          onUndo={(checkpoint) => void undo(checkpoint)}
          onOpenProposal={openProposal}
          onResolve={(changeset, action, path) => void resolve(changeset, action, path)}
        />
      )}

      {error === null ? null : (
        <div className="form-error" role="alert">
          <p>{error.message}</p>
          {error.configuration ? <Link to="/settings">Open provider settings</Link> : null}
        </div>
      )}
      {undoError === null ? null : (
        <p className="form-error" role="alert">
          {undoError}
        </p>
      )}
      {busyElsewhere ? (
        <p className="change-note">The agent is working in another chat of this book.</p>
      ) : null}
      {watching ? (
        <p className="change-note">
          The agent is working on this chat in another tab or on another device.
        </p>
      ) : null}
      {stopError === null ? null : (
        <p className="form-error" role="alert">
          {stopError}
        </p>
      )}

      <StoryCommandsPanel onAsk={draft.ask} />
      <AgentComposer
        // A turn the server refused before it started gives its message back
        // (for a chat started from the Agent tab, the draft was typed there).
        key={error?.draft ?? ''}
        id="agent-message-input"
        label="Message"
        initialDraft={error?.draft ?? ''}
        submitLabel="Send"
        running={run !== null || watching}
        stopping={run?.turn.stopping ?? (watchedId !== null && stoppingId === watchedId)}
        busy={busyElsewhere}
        onSend={(content) => runner.send(chatId, content)}
        onStop={run !== null ? runner.stop : watching ? () => void stopWatched() : undefined}
        append={draft.append}
      />

      <div className="agent-chat-footer">
        <button
          type="button"
          className="text-danger"
          disabled={run !== null || watching}
          onClick={() => setDeleting(true)}
        >
          Delete chat
        </button>
      </div>

      {inspecting === null ? null : (
        <AgentInspectorDialog message={inspecting} onClose={() => setInspecting(null)} />
      )}
      {diff === null ? null : <DiffDialog {...diff} onClose={() => setDiff(null)} />}
      {deleting ? (
        <ConfirmDialog
          title={`Delete ${chat.title}?`}
          confirmLabel="Delete chat"
          busy={deleteBusy}
          onCancel={() => setDeleting(false)}
          onConfirm={() => void remove()}
        >
          The conversation is removed. Changes the agent made to the book stay, and can still be
          undone from the Project tab.
        </ConfirmDialog>
      ) : null}
    </section>
  );
}
