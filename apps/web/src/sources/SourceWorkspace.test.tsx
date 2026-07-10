import type { Notebook, SourceDetail, SourceMetadata } from '@worldbookllm/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { AppRoutes } from '../App.js';
import { ApiProvider } from '../api/ApiContext.js';
import { ApiClientError } from '../api/client.js';
import { createTestClient } from '../test/createTestClient.js';

const notebook: Notebook = {
  id: 'a0c7607c-b365-438b-a7e6-31b2308464b6',
  name: 'Atlas of Ember',
  settings: null,
  createdAt: '2026-07-10T12:00:00.000Z',
  updatedAt: '2026-07-10T12:00:00.000Z',
};

const source: SourceMetadata = {
  id: 'f9942d0a-eaca-41a8-a3d8-87987cc173fd',
  notebookId: notebook.id,
  title: 'The Glass Marsh',
  slug: 'the-glass-marsh',
  filePath: `notebooks/${notebook.id}/sources/f9942d0a-eaca-41a8-a3d8-87987cc173fd-the-glass-marsh.md`,
  origin: 'paste',
  wordCount: 11,
  contentHash: 'b'.repeat(64),
  createdAt: '2026-07-10T12:00:00.000Z',
  updatedAt: '2026-07-10T12:00:00.000Z',
};

const detail: SourceDetail = {
  ...source,
  content:
    '# The Glass Marsh\n\n- Brine mirrors\n- Reed lanterns\n\n| Tide | Color |\n| --- | --- |\n| Low | Violet |\n\n<script>alert("unsafe")</script>',
};

function LocationProbe() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

function renderPath(path: string, overrides = {}) {
  const client = createTestClient({
    getNotebook: () => Promise.resolve(notebook),
    listSources: () => Promise.resolve([source]),
    getSource: () => Promise.resolve(detail),
    ...overrides,
  });
  return {
    client,
    ...render(
      <ApiProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes />
          <LocationProbe />
        </MemoryRouter>
      </ApiProvider>,
    ),
  };
}

describe('notebook source workspace', () => {
  it('shows the source index and mobile navigation contract', async () => {
    renderPath(`/notebooks/${notebook.id}`);

    expect(await screen.findByRole('heading', { name: notebook.name })).toBeDefined();
    expect(screen.getByRole('link', { name: source.title }).getAttribute('href')).toBe(
      `/notebooks/${notebook.id}/sources/${source.id}`,
    );
    expect(screen.getByText(/updated jul 10/i)).toBeDefined();
    expect(screen.getByRole('navigation', { name: 'Notebook workspace' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Notebooks' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Sources' })).toBeDefined();
    expect(screen.getByText('Reader').getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText(/chat workspace opens in phase 8/i)).toBeDefined();
  });

  it('pastes a source and navigates to the server-returned reader', async () => {
    const createSource = vi.fn().mockResolvedValue(source);
    renderPath(`/notebooks/${notebook.id}`, {
      listSources: () => Promise.resolve([]),
      createSource,
    });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Paste source' }));
    expect(screen.getByRole('dialog', { name: 'Paste a Markdown source' })).toBeDefined();
    await user.type(screen.getByRole('textbox', { name: 'Source title' }), source.title);
    await user.type(screen.getByRole('textbox', { name: 'Markdown content' }), '# Marsh lore');
    await user.click(screen.getByRole('button', { name: 'Save source' }));

    await waitFor(() =>
      expect(createSource).toHaveBeenCalledWith(notebook.id, {
        title: source.title,
        content: '# Marsh lore',
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        `/notebooks/${notebook.id}/sources/${source.id}`,
      ),
    );
  });

  it('dismisses the paste dialog with Escape and restores trigger focus', async () => {
    renderPath(`/notebooks/${notebook.id}`);
    const user = userEvent.setup();
    const trigger = await screen.findByRole('button', { name: 'Paste source' });

    await user.click(trigger);
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Source title' }));
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Paste a Markdown source' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('renders safe GFM and exposes the exact raw Markdown', async () => {
    const { container } = renderPath(`/notebooks/${notebook.id}/sources/${source.id}`);
    const user = userEvent.setup();

    expect(await screen.findByRole('heading', { name: source.title, level: 1 })).toBeDefined();
    expect(screen.getByRole('table')).toBeDefined();
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByText(source.filePath)).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Raw' }));

    expect(screen.getByRole('region', { name: 'Raw Markdown' }).textContent).toContain(
      '<script>alert("unsafe")</script>',
    );
  });

  it('deletes the active source and returns to its index', async () => {
    const deleteSource = vi.fn().mockResolvedValue(undefined);
    renderPath(`/notebooks/${notebook.id}/sources/${source.id}`, { deleteSource });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: `Delete ${source.title}` }));
    expect(screen.getByRole('dialog', { name: 'Delete source?' })).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Delete source' }));

    await waitFor(() => expect(deleteSource).toHaveBeenCalledWith(source.id));
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(`/notebooks/${notebook.id}`),
    );
  });

  it('keeps notebook and source failures distinct and retryable', async () => {
    const listSources = vi
      .fn()
      .mockRejectedValueOnce(new ApiClientError(500, 'internal_error', 'Internal server error'))
      .mockResolvedValueOnce([]);
    renderPath(`/notebooks/${notebook.id}`, { listSources });
    const user = userEvent.setup();

    expect(await screen.findByRole('heading', { name: 'Could not load sources' })).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/no sources plotted/i)).toBeDefined();
    expect(listSources).toHaveBeenCalledTimes(2);
  });

  it('renders notebook and reader not-found states', async () => {
    const { unmount } = renderPath(`/notebooks/${notebook.id}`, {
      getNotebook: () => Promise.reject(new ApiClientError(404, 'not_found', 'Notebook not found')),
    });
    expect(await screen.findByRole('heading', { name: 'Notebook not found' })).toBeDefined();
    unmount();

    renderPath(`/notebooks/${notebook.id}/sources/${source.id}`, {
      getSource: () => Promise.reject(new ApiClientError(404, 'not_found', 'Source not found')),
    });
    expect(await screen.findByRole('heading', { name: 'Source not found' })).toBeDefined();
  });

  it('rejects a source detail that belongs to another notebook', async () => {
    renderPath(`/notebooks/${notebook.id}/sources/${source.id}`, {
      getSource: () =>
        Promise.resolve({
          ...detail,
          notebookId: 'a55cb9f0-4776-47b3-91d4-51dd5651e8e8',
        }),
    });

    expect(await screen.findByRole('heading', { name: 'Source not found' })).toBeDefined();
    expect(screen.queryByRole('heading', { name: source.title })).toBeNull();
  });
});
