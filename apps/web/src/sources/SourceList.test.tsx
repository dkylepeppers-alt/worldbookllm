import type { Notebook, SourceMetadata, SourceSearchResult } from '@worldbookllm/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { ApiClient } from '../api/client.js';
import { ApiProvider } from '../api/ApiContext.js';
import { NotebookWorkspaceContext } from '../notebooks/notebook-workspace-context.js';
import { createTestClient } from '../test/createTestClient.js';
import { SourceList } from './SourceList.js';

const notebook: Notebook = {
  id: 'a0c7607c-b365-438b-a7e6-31b2308464b6',
  name: 'Atlas',
  settings: null,
  createdAt: '2026-07-10T12:00:00.000Z',
  updatedAt: '2026-07-10T12:00:00.000Z',
};

function source(
  id: string,
  title: string,
  overrides: Partial<SourceMetadata> = {},
): SourceMetadata {
  return {
    id,
    notebookId: notebook.id,
    title,
    slug: title.toLowerCase(),
    filePath: `notebooks/${id}.md`,
    origin: { type: 'paste' },
    conversionNotes: [],
    category: null,
    tags: [],
    wordCount: 4,
    contentHash: 'a'.repeat(64),
    createdAt: '2026-07-10T12:00:00.000Z',
    updatedAt: '2026-07-10T12:00:00.000Z',
    ...overrides,
  };
}

const charter = source('11111111-1111-4111-8111-111111111111', 'Charter', {
  category: 'factions',
  tags: ['iron-compact'],
});
const marsh = source('22222222-2222-4222-8222-222222222222', 'Marsh', {
  category: 'places',
  updatedAt: '2026-07-12T12:00:00.000Z',
});
const gossip = source('33333333-3333-4333-8333-333333333333', 'Gossip');

function renderList(sources: SourceMetadata[], overrides: Partial<ApiClient> = {}) {
  const client = createTestClient(overrides);
  render(
    <ApiProvider client={client}>
      <MemoryRouter initialEntries={[`/notebooks/${notebook.id}`]}>
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
          <SourceList />
        </NotebookWorkspaceContext.Provider>
      </MemoryRouter>
    </ApiProvider>,
  );
}

function visibleTitles(): string[] {
  return within(screen.getByRole('list'))
    .getAllByRole('link')
    .map((link) => {
      return link.getAttribute('aria-label') ?? '';
    });
}

describe('SourceList browsing', () => {
  it('filters by category and tag, showing organization labels on rows', async () => {
    renderList([charter, marsh, gossip]);
    expect(visibleTitles()).toEqual(['Charter', 'Marsh', 'Gossip']);
    expect(screen.getByText('factions · #iron-compact')).toBeDefined();

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Category'), 'factions');
    expect(visibleTitles()).toEqual(['Charter']);

    await user.selectOptions(screen.getByLabelText('Category'), 'all');
    await user.selectOptions(screen.getByLabelText('Tag'), 'iron-compact');
    expect(visibleTitles()).toEqual(['Charter']);

    await user.selectOptions(screen.getByLabelText('Tag'), 'all');
    expect(visibleTitles()).toEqual(['Charter', 'Marsh', 'Gossip']);
  });

  it('hides the tag filter when no source has tags', () => {
    renderList([marsh, gossip]);
    expect(screen.queryByLabelText('Tag')).toBeNull();
  });

  it('sorts by recently updated and title', async () => {
    renderList([charter, marsh, gossip]);
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText('Sort'), 'updated');
    expect(visibleTitles()).toEqual(['Marsh', 'Charter', 'Gossip']);

    await user.selectOptions(screen.getByLabelText('Sort'), 'title');
    expect(visibleTitles()).toEqual(['Charter', 'Gossip', 'Marsh']);
  });

  it('searches the notebook, rendering ranked results with excerpts', async () => {
    const results: SourceSearchResult[] = [
      { ...gossip, excerpt: 'whispers about the Iron Compact quays' },
      { ...charter, excerpt: 'founding charter of the cartel' },
    ];
    const searchSources = vi.fn(() => Promise.resolve(results));
    renderList([charter, marsh, gossip], { searchSources });
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Search'), 'iron compact');
    await waitFor(() =>
      expect(searchSources).toHaveBeenCalledWith(notebook.id, 'iron compact', expect.anything()),
    );
    await waitFor(() => expect(visibleTitles()).toEqual(['Gossip', 'Charter']));
    expect(screen.getByText('whispers about the Iron Compact quays')).toBeDefined();

    // Filters intersect the search results client-side.
    await user.selectOptions(screen.getByLabelText('Category'), 'factions');
    expect(visibleTitles()).toEqual(['Charter']);

    await user.clear(screen.getByLabelText('Search'));
    await waitFor(() => expect(screen.queryByText(/whispers about/)).toBeNull());
    await user.selectOptions(screen.getByLabelText('Category'), 'all');
    expect(visibleTitles()).toEqual(['Charter', 'Marsh', 'Gossip']);
  });

  it('drops search hits whose source is no longer in the workspace', async () => {
    // A hit for a just-deleted source (the refreshed search hasn't landed
    // yet) must not render as a broken link.
    const deleted: SourceSearchResult = {
      ...source('44444444-4444-4444-8444-444444444444', 'Deleted'),
      excerpt: 'vanished content',
    };
    const searchSources = vi.fn(() => Promise.resolve([deleted, { ...charter, excerpt: 'kept' }]));
    renderList([charter], { searchSources });
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Search'), 'vanished');
    await waitFor(() => expect(visibleTitles()).toEqual(['Charter']));
    expect(screen.queryByText('vanished content')).toBeNull();
  });

  it('shows an empty bearing message when nothing matches', async () => {
    const searchSources = vi.fn(() => Promise.resolve([]));
    renderList([charter], { searchSources });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Search'), 'nothing');
    await waitFor(() => expect(screen.getByText('No sources match this bearing')).toBeDefined());
  });
});
