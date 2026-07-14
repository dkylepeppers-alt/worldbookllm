import type {
  Chat,
  ChatDetail,
  Message,
  Notebook,
  ProviderCatalogEntry,
  SourceMetadata,
} from '@worldbookllm/shared';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { AppRoutes } from '../App.js';
import { ApiProvider } from '../api/ApiContext.js';
import { ApiClientError } from '../api/client.js';
import { createScriptedStream, createTestClient } from '../test/createTestClient.js';

const notebook: Notebook = {
  id: 'a0c7607c-b365-438b-a7e6-31b2308464b6',
  name: 'Atlas of Ember',
  settings: { source: 'nanogpt', model: 'nano-story' },
  createdAt: '2026-07-10T12:00:00.000Z',
  updatedAt: '2026-07-10T12:00:00.000Z',
};

const provider: ProviderCatalogEntry = {
  source: 'nanogpt',
  label: 'NanoGPT',
  family: 'openai-compat',
  secretKey: 'api_key_nanogpt',
  modelSource: 'live',
  hasSecret: true,
};

const chat: Chat = {
  id: '60a0bf0c-031d-497c-9c1a-2f68441936a6',
  notebookId: notebook.id,
  title: 'First chat',
  sourceIds: [],
  providerOverride: null,
  createdAt: '2026-07-10T12:00:00.000Z',
  updatedAt: '2026-07-10T12:00:00.000Z',
};

const userMessage: Message = {
  id: '0d0f9d64-5c05-45a9-9a34-53e33a9c2b41',
  chatId: chat.id,
  seq: 0,
  role: 'user',
  content: 'Tell me about the coast.',
  reasoning: null,
  status: 'complete',
  context: null,
  createdAt: '2026-07-10T12:01:00.000Z',
};

const assistantMessage: Message = {
  id: '3fdd7a3e-6d4e-4a56-a2a4-8b8a29f6d0cf',
  chatId: chat.id,
  seq: 1,
  role: 'assistant',
  content: 'The coast is brass.',
  reasoning: null,
  status: 'complete',
  context: { sourceIds: [], provider: 'nanogpt', model: 'nano-story', strictness: 'grounded' },
  createdAt: '2026-07-10T12:01:05.000Z',
};

function detailWith(messages: Message[], sourceIds: string[] = []): ChatDetail {
  return { ...chat, sourceIds, messages };
}

function renderWorkspace(overrides = {}, value: Notebook = notebook) {
  const client = createTestClient({
    getNotebook: () => Promise.resolve(value),
    listSources: () => Promise.resolve([]),
    getProviderCatalog: () => Promise.resolve([provider]),
    listChats: () => Promise.resolve([chat]),
    getChat: () => Promise.resolve(detailWith([])),
    ...overrides,
  });
  render(
    <ApiProvider client={client}>
      <MemoryRouter initialEntries={[`/notebooks/${notebook.id}`]}>
        <AppRoutes />
      </MemoryRouter>
    </ApiProvider>,
  );
  return client;
}

describe('ChatPanel', () => {
  it('creates, selects, renames, and deletes chats', async () => {
    const created = { ...chat, title: 'New chat' };
    const renamed = { ...created, title: 'Revised chat' };
    const createChat = vi.fn().mockResolvedValue(created);
    const updateChat = vi.fn().mockResolvedValue(renamed);
    const deleteChat = vi.fn().mockResolvedValue(undefined);
    const listChats = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    renderWorkspace({ createChat, updateChat, deleteChat, listChats });
    const user = userEvent.setup();

    expect(await screen.findByText('No chats yet.')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'New chat' }));
    expect(createChat).toHaveBeenCalledWith(notebook.id, {});
    expect(await screen.findByRole('heading', { name: created.title, level: 3 })).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Rename' }));
    const title = screen.getByLabelText('Chat title');
    await user.clear(title);
    await user.type(title, renamed.title);
    await user.click(screen.getByRole('button', { name: 'Save title' }));
    await waitFor(() => expect(updateChat).toHaveBeenCalledWith(chat.id, { title: renamed.title }));
    expect(await screen.findByRole('heading', { name: renamed.title, level: 3 })).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Delete chat' }));
    await waitFor(() => expect(deleteChat).toHaveBeenCalledWith(chat.id));
    expect(await screen.findByText('No chats yet.')).toBeDefined();
    expect(listChats).toHaveBeenCalledTimes(2);
  });

  it('persists notebook defaults and updates their visible summary', async () => {
    const unconfigured = { ...notebook, settings: null };
    const updateNotebook = vi.fn().mockResolvedValue(notebook);
    renderWorkspace({ listChats: () => Promise.resolve([]), updateNotebook }, unconfigured);
    const user = userEvent.setup();

    expect(await screen.findByText('Not configured')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Configure provider' }));
    await user.selectOptions(await screen.findByLabelText('Provider'), 'nanogpt');
    await user.type(screen.getByLabelText('Model'), 'nano-story');
    await user.click(screen.getByRole('button', { name: 'Save provider' }));

    await waitFor(() =>
      expect(updateNotebook).toHaveBeenCalledWith(notebook.id, {
        settings: { source: 'nanogpt', model: 'nano-story' },
      }),
    );
    expect(await screen.findByText('NanoGPT · nano-story')).toBeDefined();
  });

  it('sets and clears a complete chat provider override', async () => {
    const overridden = {
      ...chat,
      providerOverride: { source: 'nanogpt' as const, model: 'override-model' },
    };
    const updateChat = vi
      .fn()
      .mockResolvedValueOnce(overridden)
      .mockResolvedValueOnce({ ...chat, providerOverride: null });
    renderWorkspace({ updateChat });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: new RegExp(chat.title) }));
    await user.click(screen.getByRole('button', { name: 'Edit provider override' }));
    const model = await screen.findByLabelText('Model');
    await user.clear(model);
    await user.type(model, 'override-model');
    await user.click(screen.getByRole('button', { name: 'Save provider' }));
    await waitFor(() =>
      expect(updateChat).toHaveBeenNthCalledWith(1, chat.id, {
        providerOverride: { source: 'nanogpt', model: 'override-model' },
      }),
    );

    await user.click(await screen.findByRole('button', { name: 'Use notebook default' }));
    await waitFor(() =>
      expect(updateChat).toHaveBeenNthCalledWith(2, chat.id, { providerOverride: null }),
    );
  });

  it('renders persisted history in seq order with status badges', async () => {
    const interrupted: Message = {
      ...assistantMessage,
      id: '9a1de1a1-63a4-4b8c-9a3e-6d3f7a15c111',
      seq: 3,
      content: 'A partial answer',
      status: 'interrupted',
    };
    const errored: Message = {
      ...assistantMessage,
      id: 'b30cf1de-8a9e-4a53-8a3a-2f60a1c22222',
      seq: 1,
      content: 'A failed answer',
      status: 'error',
    };
    const later: Message = {
      ...userMessage,
      id: 'c41df2ef-9baf-4b64-9b4b-3a71b2d33333',
      seq: 2,
      content: 'Go on.',
    };
    renderWorkspace({
      getChat: () => Promise.resolve(detailWith([interrupted, errored, later, userMessage])),
    });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: new RegExp(chat.title) }));
    const list = await screen.findByRole('list', { name: 'Messages' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining(userMessage.content),
      expect.stringContaining('A failed answer'),
      expect.stringContaining('Go on.'),
      expect.stringContaining('A partial answer'),
    ]);
    expect(within(items[1] as HTMLElement).getByText('Error')).toBeDefined();
    expect(within(items[3] as HTMLElement).getByText('Interrupted')).toBeDefined();
    expect(screen.queryByText('Messages and streaming arrive in Phase 9.')).toBeNull();
  });

  it('shows an inviting empty state for a chat without messages', async () => {
    renderWorkspace();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: new RegExp(chat.title) }));
    expect(await screen.findByText(/Ask about your sources/)).toBeDefined();
    expect(screen.queryByText('Messages and streaming arrive in Phase 9.')).toBeNull();
  });

  it('accumulates deltas into an ephemeral bubble and swaps in the persisted reply', async () => {
    const stream = createScriptedStream();
    const getChat = vi
      .fn()
      .mockResolvedValueOnce(detailWith([]))
      .mockResolvedValue(detailWith([userMessage, assistantMessage]));
    renderWorkspace({ getChat, streamMessage: stream.streamMessage });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: new RegExp(chat.title) }));
    await user.type(await screen.findByLabelText('Message'), userMessage.content);
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() =>
      expect(stream.calls).toEqual([{ chatId: chat.id, content: userMessage.content }]),
    );
    expect(await screen.findByText(userMessage.content)).toBeDefined();
    const send = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);

    act(() => stream.emit({ type: 'delta', text: 'The coast ' }));
    act(() => stream.emit({ type: 'delta', text: 'is brass.' }));
    expect(await screen.findByText('The coast is brass.')).toBeDefined();

    act(() => stream.emit({ type: 'done', message: assistantMessage }));
    await waitFor(() => expect(getChat).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('The coast is brass.')).toBeDefined();
    expect(screen.getAllByText('The coast is brass.')).toHaveLength(1);
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
  });

  it('shows the safe message and persisted error state on a stream error event', async () => {
    const errored: Message = { ...assistantMessage, content: 'Partial text', status: 'error' };
    const stream = createScriptedStream();
    const getChat = vi
      .fn()
      .mockResolvedValueOnce(detailWith([]))
      .mockResolvedValue(detailWith([userMessage, errored]));
    renderWorkspace({ getChat, streamMessage: stream.streamMessage });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: new RegExp(chat.title) }));
    await user.type(await screen.findByLabelText('Message'), 'Hi');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(stream.calls).toHaveLength(1));

    act(() =>
      stream.emit({
        type: 'error',
        code: 'provider_error',
        message: 'Provider generation failed',
        messageState: errored,
      }),
    );

    expect(await screen.findByText('Provider generation failed')).toBeDefined();
    expect(await screen.findByText('Error')).toBeDefined();
    expect(await screen.findByText('Partial text')).toBeDefined();
  });

  it('renders a 409 generation-in-progress rejection inline', async () => {
    const streamMessage = vi
      .fn()
      .mockRejectedValue(
        new ApiClientError(409, 'generation_in_progress', 'Generation only runs one at a time.'),
      );
    renderWorkspace({ streamMessage });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: new RegExp(chat.title) }));
    await user.type(await screen.findByLabelText('Message'), 'Hi');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('Generation only runs one at a time.')).toBeDefined();
  });

  it('stops a stream and reconstructs the persisted interrupted message', async () => {
    const interrupted: Message = { ...assistantMessage, content: 'tick 0', status: 'interrupted' };
    const stream = createScriptedStream();
    const getChat = vi
      .fn()
      .mockResolvedValueOnce(detailWith([]))
      .mockResolvedValue(detailWith([userMessage, interrupted]));
    renderWorkspace({ getChat, streamMessage: stream.streamMessage });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: new RegExp(chat.title) }));
    await user.type(await screen.findByLabelText('Message'), 'Hi');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(stream.calls).toHaveLength(1));
    act(() => stream.emit({ type: 'delta', text: 'tick 0' }));

    await user.click(screen.getByRole('button', { name: 'Stop' }));

    await waitFor(() => expect(getChat).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Interrupted')).toBeDefined();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('falls back to a refetch when the stream drops mid-flight', async () => {
    const interrupted: Message = { ...assistantMessage, content: 'tick 0', status: 'interrupted' };
    const stream = createScriptedStream();
    const getChat = vi
      .fn()
      .mockResolvedValueOnce(detailWith([]))
      .mockResolvedValue(detailWith([userMessage, interrupted]));
    renderWorkspace({ getChat, streamMessage: stream.streamMessage });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: new RegExp(chat.title) }));
    await user.type(await screen.findByLabelText('Message'), 'Hi');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(stream.calls).toHaveLength(1));

    act(() => stream.fail(new ApiClientError(0, 'network_error', 'Could not reach the server.')));

    expect(await screen.findByText('Could not reach the server.')).toBeDefined();
    await waitFor(() => expect(getChat).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Interrupted')).toBeDefined();
  });

  it('persists source selection as a complete replacement', async () => {
    const sourceA: SourceMetadata = {
      id: '7d55ac1e-3f0a-4b8e-8a4e-1d2f3a4b5c60',
      notebookId: notebook.id,
      title: 'Field notes',
      slug: 'field-notes',
      filePath: 'notebooks/x/sources/field-notes.md',
      origin: 'paste',
      wordCount: 7,
      contentHash: 'a'.repeat(64),
      createdAt: '2026-07-10T12:00:00.000Z',
      updatedAt: '2026-07-10T12:00:00.000Z',
    };
    const sourceB: SourceMetadata = {
      ...sourceA,
      id: '8e66bd2f-4a1b-4c9f-9b5f-2e3a4b5c6d71',
      title: 'Tide charts',
      slug: 'tide-charts',
    };
    const updateChat = vi
      .fn()
      .mockResolvedValueOnce({ ...chat, sourceIds: [sourceB.id] })
      .mockResolvedValueOnce({ ...chat, sourceIds: [sourceA.id, sourceB.id] });
    renderWorkspace({
      listSources: () => Promise.resolve([sourceA, sourceB]),
      getChat: () => Promise.resolve(detailWith([], [sourceA.id, sourceB.id])),
      updateChat,
    });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: new RegExp(chat.title) }));
    expect(await screen.findByText('2 of 2 sources selected')).toBeDefined();

    await user.click(await screen.findByRole('checkbox', { name: 'Field notes' }));
    await waitFor(() =>
      expect(updateChat).toHaveBeenNthCalledWith(1, chat.id, { sourceIds: [sourceB.id] }),
    );
    expect(await screen.findByText('1 of 2 sources selected')).toBeDefined();

    await user.click(screen.getByRole('checkbox', { name: 'Field notes' }));
    await waitFor(() =>
      expect(updateChat).toHaveBeenNthCalledWith(2, chat.id, {
        sourceIds: [sourceA.id, sourceB.id],
      }),
    );
    expect(await screen.findByText('2 of 2 sources selected')).toBeDefined();
  });

  it('retries an explicit chat-list failure', async () => {
    const listChats = vi
      .fn()
      .mockRejectedValueOnce(new ApiClientError(500, 'internal_error', 'Failed'))
      .mockResolvedValueOnce([]);
    renderWorkspace({ listChats });
    const user = userEvent.setup();

    expect(await screen.findByRole('heading', { name: 'Could not load chats' })).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No chats yet.')).toBeDefined();
    expect(listChats).toHaveBeenCalledTimes(2);
  });
});
