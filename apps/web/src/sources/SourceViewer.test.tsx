import type { Notebook, SourceDetail } from '@worldbookllm/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { ApiProvider } from '../api/ApiContext.js';
import { NotebookWorkspaceContext } from '../notebooks/notebook-workspace-context.js';
import { createTestClient } from '../test/createTestClient.js';
import { SourceViewer } from './SourceViewer.js';

const notebook: Notebook = {
  id: 'a0c7607c-b365-438b-a7e6-31b2308464b6',
  name: 'Atlas',
  settings: null,
  createdAt: '2026-07-10T12:00:00.000Z',
  updatedAt: '2026-07-10T12:00:00.000Z',
};

const source: SourceDetail = {
  id: 'b0c7607c-b365-438b-a7e6-31b2308464b6',
  notebookId: notebook.id,
  title: 'Lore',
  slug: 'lore',
  filePath: 'notebooks/lore.md',
  origin: { type: 'paste' },
  conversionNotes: [],
  category: null,
  tags: [],
  wordCount: 2,
  contentHash: 'a'.repeat(64),
  createdAt: '2026-07-10T12:00:00.000Z',
  updatedAt: '2026-07-10T12:00:00.000Z',
  content: 'Old body',
};

function renderViewer(overrides = {}) {
  const updateSource = vi.fn();
  const onUpdated = vi.fn();
  const client = createTestClient(overrides);
  render(
    <ApiProvider client={client}>
      <MemoryRouter initialEntries={[`/notebooks/${notebook.id}`]}>
        <NotebookWorkspaceContext.Provider
          value={{
            notebook,
            notebookId: notebook.id,
            sourcesState: { status: 'ready', sources: [] },
            retrySources: vi.fn(),
            addSource: vi.fn(),
            updateSource,
            removeSource: vi.fn(),
            replaceNotebook: vi.fn(),
            lastSourceId: null,
            setLastSourceId: vi.fn(),
          }}
        >
          <SourceViewer source={source} onUpdated={onUpdated} />
        </NotebookWorkspaceContext.Provider>
      </MemoryRouter>
    </ApiProvider>,
  );
  return { updateSource, onUpdated };
}

describe('SourceViewer editing', () => {
  it('saves an edited title and content via updateSource', async () => {
    const updated: SourceDetail = {
      ...source,
      title: 'Renamed',
      slug: 'renamed',
      filePath: 'notebooks/renamed.md',
      content: 'Fresh body text',
      wordCount: 3,
    };
    const patch = vi.fn(() => Promise.resolve(updated));
    const { updateSource, onUpdated } = renderViewer({ updateSource: patch });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Edit Lore' }));
    const title = screen.getByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'Renamed');
    const body = screen.getByLabelText('Source Markdown');
    await user.clear(body);
    await user.type(body, 'Fresh body text');
    await user.click(screen.getByRole('button', { name: 'Save source' }));

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenCalledWith(source.id, {
      title: 'Renamed',
      content: 'Fresh body text',
      category: null,
      tags: [],
    });
    expect(onUpdated).toHaveBeenCalledWith(updated);
    // The workspace source list is refreshed with metadata only (no content).
    expect(updateSource).toHaveBeenCalledWith(
      expect.objectContaining({ id: source.id, title: 'Renamed' }),
    );
    expect(updateSource.mock.calls[0]?.[0]).not.toHaveProperty('content');
  });

  it('saves a category and comma-separated tags via updateSource', async () => {
    const updated: SourceDetail = {
      ...source,
      category: 'factions',
      tags: ['iron-compact', 'smugglers'],
    };
    const patch = vi.fn(() => Promise.resolve(updated));
    renderViewer({ updateSource: patch });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Edit Lore' }));
    await user.selectOptions(screen.getByLabelText('Category'), 'factions');
    await user.type(screen.getByLabelText('Tags'), ' iron-compact, smugglers , ');
    await user.click(screen.getByRole('button', { name: 'Save source' }));

    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith(source.id, {
        title: 'Lore',
        content: 'Old body',
        category: 'factions',
        tags: ['iron-compact', 'smugglers'],
      }),
    );
  });

  it('shows category and tags as metadata labels when set', () => {
    const client = createTestClient();
    render(
      <ApiProvider client={client}>
        <MemoryRouter initialEntries={[`/notebooks/${notebook.id}`]}>
          <NotebookWorkspaceContext.Provider
            value={{
              notebook,
              notebookId: notebook.id,
              sourcesState: { status: 'ready', sources: [] },
              retrySources: vi.fn(),
              addSource: vi.fn(),
              updateSource: vi.fn(),
              removeSource: vi.fn(),
              replaceNotebook: vi.fn(),
              lastSourceId: null,
              setLastSourceId: vi.fn(),
            }}
          >
            <SourceViewer
              source={{ ...source, category: 'places', tags: ['marsh'] }}
              onUpdated={vi.fn()}
            />
          </NotebookWorkspaceContext.Provider>
        </MemoryRouter>
      </ApiProvider>,
    );
    expect(screen.getByText(/places/).textContent).toContain('#marsh');
  });

  it('rejects an empty edit without calling the API', async () => {
    const patch = vi.fn(() => Promise.resolve(source));
    renderViewer({ updateSource: patch });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Edit Lore' }));
    await user.clear(screen.getByLabelText('Source Markdown'));
    await user.click(screen.getByRole('button', { name: 'Save source' }));
    expect(screen.getByRole('alert').textContent).toContain('cannot be empty');
    expect(patch).not.toHaveBeenCalled();
  });
});
