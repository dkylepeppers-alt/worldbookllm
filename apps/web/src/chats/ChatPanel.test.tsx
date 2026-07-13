import type { Chat, Notebook, ProviderCatalogEntry } from '@worldbookllm/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { AppRoutes } from '../App.js';
import { ApiProvider } from '../api/ApiContext.js';
import { ApiClientError } from '../api/client.js';
import { createTestClient } from '../test/createTestClient.js';

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

function renderWorkspace(overrides = {}, value: Notebook = notebook) {
  const client = createTestClient({
    getNotebook: () => Promise.resolve(value),
    listSources: () => Promise.resolve([]),
    getProviderCatalog: () => Promise.resolve([provider]),
    listChats: () => Promise.resolve([chat]),
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

    await user.click(await screen.findByRole('button', { name: chat.title }));
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
