import type { Chat, Notebook, SourceMetadata } from '@worldbookllm/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ApiProvider } from '../api/ApiContext.js';
import { NotebookWorkspaceContext } from '../notebooks/notebook-workspace-context.js';
import { createTestClient } from '../test/createTestClient.js';
import { SourceSelector } from './SourceSelector.js';

const notebook: Notebook = {
  id: 'a0c7607c-b365-438b-a7e6-31b2308464b6',
  name: 'Atlas',
  settings: null,
  createdAt: '2026-07-10T12:00:00.000Z',
  updatedAt: '2026-07-10T12:00:00.000Z',
};

function source(id: string, title: string): SourceMetadata {
  return {
    id,
    notebookId: notebook.id,
    title,
    slug: title.toLowerCase(),
    filePath: `notebooks/${id}.md`,
    origin: { type: 'paste' },
    conversionNotes: [],
    wordCount: 1,
    contentHash: 'a'.repeat(64),
    createdAt: '2026-07-10T12:00:00.000Z',
    updatedAt: '2026-07-10T12:00:00.000Z',
  };
}

const sources = [
  source('11111111-1111-4111-8111-111111111111', 'Alpha'),
  source('22222222-2222-4222-8222-222222222222', 'Beta'),
];

const chat: Chat = {
  id: '60a0bf0c-031d-497c-9c1a-2f68441936a6',
  notebookId: notebook.id,
  title: 'Chat',
  sourceIds: [],
  skillIds: [],
  providerOverride: null,
  presetId: null,
  createdAt: '2026-07-10T12:00:00.000Z',
  updatedAt: '2026-07-10T12:00:00.000Z',
};

function renderSelector(selectedSourceIds: string[], updateChat = vi.fn()) {
  const client = createTestClient({
    updateChat: (id, input) => {
      updateChat(id, input);
      return Promise.resolve({ ...chat, sourceIds: input.sourceIds ?? [] });
    },
  });
  render(
    <ApiProvider client={client}>
      <NotebookWorkspaceContext.Provider
        value={{
          notebook,
          notebookId: notebook.id,
          sourcesState: { status: 'ready', sources },
          retrySources: vi.fn(),
          addSource: vi.fn(),
          updateSource: vi.fn(),
          removeSource: vi.fn(),
          replaceNotebook: vi.fn(),
          lastSourceId: null,
          setLastSourceId: vi.fn(),
        }}
      >
        <SourceSelector
          chatId={chat.id}
          selectedSourceIds={selectedSourceIds}
          onChatUpdated={vi.fn()}
        />
      </NotebookWorkspaceContext.Provider>
    </ApiProvider>,
  );
  return { updateChat };
}

describe('SourceSelector bulk actions', () => {
  it('selects every source in a single PATCH', async () => {
    const updateChat = vi.fn();
    renderSelector([], updateChat);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Select all' }));
    await waitFor(() => expect(updateChat).toHaveBeenCalledTimes(1));
    expect(updateChat).toHaveBeenCalledWith(chat.id, {
      sourceIds: sources.map((entry) => entry.id),
    });
  });

  it('clears the selection in a single PATCH', async () => {
    const updateChat = vi.fn();
    renderSelector(
      sources.map((entry) => entry.id),
      updateChat,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Clear all' }));
    await waitFor(() => expect(updateChat).toHaveBeenCalledTimes(1));
    expect(updateChat).toHaveBeenCalledWith(chat.id, { sourceIds: [] });
  });

  it('disables Select all when everything is already selected', () => {
    renderSelector(sources.map((entry) => entry.id));
    expect(screen.getByRole('button', { name: 'Select all' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Clear all' })).toHaveProperty('disabled', false);
  });
});
