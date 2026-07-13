import type { Chat, ProviderCatalogEntry, ProviderConfig } from '@worldbookllm/shared';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';

import { ApiClientError } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { ErrorState, LoadingState } from '../components/RequestState.js';
import { useDialogLifecycle } from '../components/useDialogLifecycle.js';
import { useNotebookWorkspace } from '../notebooks/notebook-workspace-context.js';
import { ProviderConfigDialog } from '../providers/ProviderConfigDialog.js';

type ChatsState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; chats: Chat[] };

export function ChatPanel() {
  const api = useApi();
  const { notebook, notebookId, replaceNotebook } = useNotebookWorkspace();
  const [state, setState] = useState<ChatsState>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const [catalog, setCatalog] = useState<ProviderCatalogEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [configuringNotebook, setConfiguringNotebook] = useState(false);
  const [renaming, setRenaming] = useState<Chat | null>(null);
  const [configuringChat, setConfiguringChat] = useState<Chat | null>(null);
  const [deleting, setDeleting] = useState<Chat | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [clearingOverride, setClearingOverride] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const loadChats = useCallback(
    (signal?: AbortSignal) => api.listChats(notebookId, signal),
    [api, notebookId],
  );

  const applyChats = useCallback((chats: Chat[]) => {
    setState({ status: 'ready', chats });
    setSelectedId((current) =>
      current !== null && chats.some((chat) => chat.id === current) ? current : null,
    );
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadChats(controller.signal)
      .then(applyChats)
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setState({ status: 'error' });
        }
      });
    return () => controller.abort();
  }, [applyChats, loadChats, reloadKey]);

  useEffect(() => {
    const controller = new AbortController();
    void api
      .getProviderCatalog(controller.signal)
      .then(setCatalog)
      .catch(() => undefined);
    return () => controller.abort();
  }, [api]);

  const selected =
    state.status === 'ready' ? (state.chats.find((chat) => chat.id === selectedId) ?? null) : null;

  async function create() {
    if (creating) return;
    setCreating(true);
    setMutationError(null);
    try {
      const chat = await api.createChat(notebookId, {});
      setState((current) =>
        current.status === 'ready'
          ? { status: 'ready', chats: [chat, ...current.chats] }
          : { status: 'ready', chats: [chat] },
      );
      setSelectedId(chat.id);
    } catch (error) {
      setMutationError(messageFor(error, 'Could not create a chat.'));
    } finally {
      setCreating(false);
    }
  }

  function replaceChat(chat: Chat) {
    setState((current) =>
      current.status === 'ready'
        ? {
            status: 'ready',
            chats: current.chats.map((entry) => (entry.id === chat.id ? chat : entry)),
          }
        : current,
    );
  }

  async function remove() {
    if (deleting === null) return;
    const target = deleting;
    setDeletingBusy(true);
    setMutationError(null);
    try {
      await api.deleteChat(target.id);
      setDeleting(null);
      if (selectedId === target.id) setSelectedId(null);
      applyChats(await loadChats());
    } catch (error) {
      setDeleting(null);
      setMutationError(messageFor(error, 'Could not delete this chat.'));
    } finally {
      setDeletingBusy(false);
    }
  }

  async function clearOverride(chat: Chat) {
    if (clearingOverride) return;
    setClearingOverride(true);
    setMutationError(null);
    try {
      replaceChat(await api.updateChat(chat.id, { providerOverride: null }));
    } catch (error) {
      setMutationError(messageFor(error, 'Could not clear the provider override.'));
    } finally {
      setClearingOverride(false);
    }
  }

  const effectiveConfig = selected?.providerOverride ?? notebook.settings;

  return (
    <div className="chat-panel">
      <header className="chat-provider-header">
        <div>
          <p className="coordinate-label">Notebook provider</p>
          <strong>{summary(notebook.settings, catalog)}</strong>
        </div>
        <button
          type="button"
          className="button-secondary"
          onClick={() => setConfiguringNotebook(true)}
        >
          Configure provider
        </button>
      </header>

      <div className="region-header">
        <div>
          <p className="coordinate-label">Chat index</p>
          <h2>Develop with AI</h2>
        </div>
        <button
          type="button"
          className="button-primary"
          disabled={creating}
          onClick={() => void create()}
        >
          {creating ? 'Creating…' : 'New chat'}
        </button>
      </div>

      {mutationError === null ? null : <p role="alert">{mutationError}</p>}
      {state.status === 'loading' ? <LoadingState>Loading chats…</LoadingState> : null}
      {state.status === 'error' ? (
        <ErrorState
          title="Could not load chats"
          message="The chat index could not be loaded."
          onRetry={() => {
            setState({ status: 'loading' });
            setReloadKey((value) => value + 1);
          }}
        />
      ) : null}
      {state.status === 'ready' && state.chats.length === 0 ? (
        <p className="empty-inline">No chats yet.</p>
      ) : null}
      {state.status === 'ready' && state.chats.length > 0 ? (
        <ul className="chat-list">
          {state.chats.map((chat) => (
            <li key={chat.id}>
              <button
                type="button"
                className={chat.id === selectedId ? 'active' : ''}
                aria-pressed={chat.id === selectedId}
                onClick={() => setSelectedId(chat.id)}
              >
                <span>{chat.title}</span>
                <small>{chat.providerOverride === null ? 'Inherits' : 'Override'}</small>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {selected === null ? null : (
        <section className="chat-detail" aria-label="Selected chat">
          <p className="coordinate-label">Selected chat</p>
          <h3>{selected.title}</h3>
          <p>{summary(effectiveConfig, catalog)}</p>
          <div className="inline-actions">
            <button type="button" onClick={() => setRenaming(selected)}>
              Rename
            </button>
            <button type="button" onClick={() => setConfiguringChat(selected)}>
              Edit provider override
            </button>
            {selected.providerOverride === null ? null : (
              <button
                type="button"
                disabled={clearingOverride}
                onClick={() => void clearOverride(selected)}
              >
                {clearingOverride ? 'Clearing…' : 'Use notebook default'}
              </button>
            )}
            <button type="button" className="text-danger" onClick={() => setDeleting(selected)}>
              Delete
            </button>
          </div>
          <div className="chat-message-placeholder">
            <p className="coordinate-label">Messages · Phase 9</p>
            <p>Messages and streaming arrive in Phase 9.</p>
          </div>
        </section>
      )}

      {configuringNotebook ? (
        <ProviderConfigDialog
          title="Configure notebook provider"
          initial={notebook.settings}
          clearLabel="Clear notebook default"
          onClose={() => setConfiguringNotebook(false)}
          onSave={async (settings) => {
            replaceNotebook(await api.updateNotebook(notebookId, { settings }));
          }}
          onClear={async () => {
            replaceNotebook(await api.updateNotebook(notebookId, { settings: null }));
          }}
        />
      ) : null}
      {renaming === null ? null : (
        <RenameChatDialog
          chat={renaming}
          onClose={() => setRenaming(null)}
          onSave={async (title) => {
            replaceChat(await api.updateChat(renaming.id, { title }));
            setRenaming(null);
          }}
        />
      )}
      {configuringChat === null ? null : (
        <ProviderConfigDialog
          title="Edit chat provider override"
          initial={configuringChat.providerOverride ?? notebook.settings}
          clearLabel="Use notebook default"
          onClose={() => setConfiguringChat(null)}
          onSave={async (providerOverride) => {
            replaceChat(await api.updateChat(configuringChat.id, { providerOverride }));
          }}
          onClear={async () => {
            replaceChat(await api.updateChat(configuringChat.id, { providerOverride: null }));
          }}
        />
      )}
      {deleting === null ? null : (
        <ConfirmDialog
          title="Delete chat?"
          confirmLabel="Delete chat"
          busy={deletingBusy}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void remove()}
        >
          <p>
            Delete <strong>{deleting.title}</strong>? Its message history will also be removed.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}

interface RenameChatDialogProps {
  chat: Chat;
  onClose: () => void;
  onSave: (title: string) => Promise<void>;
}

function RenameChatDialog({ chat, onClose, onSave }: RenameChatDialogProps) {
  const [title, setTitle] = useState(chat.title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useDialogLifecycle(inputRef, () => {
    if (!saving) onClose();
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (title.trim().length === 0) {
      setError('Enter a chat title.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(title.trim());
    } catch (caught) {
      setError(messageFor(caught, 'Could not rename this chat.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dialog-backdrop">
      <section
        className="dialog-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-chat-title"
      >
        <p className="coordinate-label">Chat record</p>
        <h2 id="rename-chat-title">Rename chat</h2>
        <form onSubmit={(event) => void submit(event)}>
          <label htmlFor="chat-title">Chat title</label>
          <input
            ref={inputRef}
            id="chat-title"
            maxLength={200}
            value={title}
            disabled={saving}
            onChange={(event) => setTitle(event.target.value)}
          />
          {error === null ? null : <p role="alert">{error}</p>}
          <div className="dialog-actions">
            <button type="button" className="button-secondary" disabled={saving} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="button-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save title'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function summary(config: ProviderConfig | null, catalog: ProviderCatalogEntry[]): string {
  if (config === null) return 'Not configured';
  const label = catalog.find((entry) => entry.source === config.source)?.label ?? config.source;
  return `${label} · ${config.model}`;
}

function messageFor(error: unknown, fallback: string): string {
  return error instanceof ApiClientError ? error.message : fallback;
}
