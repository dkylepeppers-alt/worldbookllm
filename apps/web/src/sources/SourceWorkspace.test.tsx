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
  origin: { type: 'paste' },
  conversionNotes: [],
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
    const mobileNavigation = screen.getByRole('navigation', { name: 'Notebook workspace' });
    expect(mobileNavigation).toBeDefined();
    expect(mobileNavigation.querySelector<HTMLAnchorElement>('a[href="/"]')?.textContent).toBe(
      'Notebooks',
    );
    expect(screen.getByRole('link', { name: 'Sources' })).toBeDefined();
    expect(screen.getByText('Reader').getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Develop with AI' })).toBeDefined();
  });

  it('pastes a source and navigates to the server-returned reader', async () => {
    const createSource = vi.fn().mockResolvedValue(source);
    renderPath(`/notebooks/${notebook.id}`, {
      listSources: () => Promise.resolve([]),
      createSource,
    });

    it('reviews a lorebook import and saves each entry as a source', async () => {
      const imported = [
        {
          ...source,
          id: '94747f0e-0e09-4db4-bcb4-82cfba819cc4',
          title: 'Amber Court',
          origin: {
            type: 'file' as const,
            fileName: 'atlas.json',
            mediaType: 'application/json',
          },
          conversionNotes: ['Activation metadata omitted.'],
        },
        {
          ...source,
          id: '52d09203-45d6-4f0c-bfc8-7dad55fda998',
          title: 'Glass Marsh',
          origin: {
            type: 'file' as const,
            fileName: 'atlas.json',
            mediaType: 'application/json',
          },
          conversionNotes: ['Activation metadata omitted.'],
        },
      ];
      const previewJsonImport = vi.fn().mockResolvedValue({
        format: 'lorebook',
        fileName: 'atlas.json',
        entries: [
          { title: 'Amber Court', markdown: 'Amber lore.' },
          { title: 'Glass Marsh', markdown: 'Marsh lore.' },
        ],
        conversionNotes: ['Activation metadata omitted.'],
      });
      const createSources = vi.fn().mockResolvedValue(imported);
      renderPath(`/notebooks/${notebook.id}`, {
        listSources: () => Promise.resolve([]),
        previewJsonImport,
        createSources,
      });
      const user = userEvent.setup();

      await user.click(await screen.findByRole('button', { name: 'Import JSON' }));
      await user.upload(
        screen.getByLabelText('JSON file'),
        new File(['{"entries":{}}'], 'atlas.json', { type: 'application/json' }),
      );
      expect(await screen.findByRole('heading', { name: 'Review JSON import' })).toBeDefined();
      const titles = screen.getAllByRole('textbox', { name: 'Source title' });
      await user.clear(titles[0] as HTMLInputElement);
      await user.type(titles[0] as HTMLInputElement, 'Revised Amber Court');
      await user.click(screen.getByRole('button', { name: 'Save 2 sources' }));

      await waitFor(() =>
        expect(createSources).toHaveBeenCalledWith(notebook.id, [
          {
            title: 'Revised Amber Court',
            content: 'Amber lore.',
            origin: { type: 'file', fileName: 'atlas.json', mediaType: 'application/json' },
            conversionNotes: ['Activation metadata omitted.'],
          },
          {
            title: 'Glass Marsh',
            content: 'Marsh lore.',
            origin: { type: 'file', fileName: 'atlas.json', mediaType: 'application/json' },
            conversionNotes: ['Activation metadata omitted.'],
          },
        ]),
      );
      await waitFor(() =>
        expect(screen.getByTestId('location').textContent).toBe(
          `/notebooks/${notebook.id}/sources/${imported[1]?.id}`,
        ),
      );
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
