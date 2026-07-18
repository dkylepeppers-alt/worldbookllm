import type { Notebook, SourceDetail, SourceMetadata } from '@worldbookllm/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { ApiClient } from '../api/client.js';
import { ApiProvider } from '../api/ApiContext.js';
import { NotebookWorkspaceContext } from '../notebooks/notebook-workspace-context.js';
import { createTestClient } from '../test/createTestClient.js';
import { SourceOrganizeDialog } from './SourceOrganizeDialog.js';

const notebook: Notebook = {
  id: 'a0c7607c-b365-438b-a7e6-31b2308464b6',
  name: 'Atlas',
  settings: { source: 'nanogpt', model: 'model-a' },
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
const gossip = source('22222222-2222-4222-8222-222222222222', 'Gossip');

function detailFor(metadata: SourceMetadata, patch: { category: unknown; tags: string[] }) {
  return {
    ...metadata,
    category: patch.category,
    tags: patch.tags,
    content: 'Body',
  } as SourceDetail;
}

function renderDialog(
  sources: SourceMetadata[],
  overrides: Partial<ApiClient>,
  workspaceUpdateSource = vi.fn(),
  onClose = vi.fn(),
) {
  const client = createTestClient(overrides);
  render(
    <ApiProvider client={client}>
      <NotebookWorkspaceContext.Provider
        value={{
          notebook,
          notebookId: notebook.id,
          sourcesState: { status: 'ready', sources },
          retrySources: vi.fn(),
          addSource: vi.fn(),
          updateSource: workspaceUpdateSource,
          removeSource: vi.fn(),
          replaceNotebook: vi.fn(),
          lastSourceId: null,
          setLastSourceId: vi.fn(),
        }}
      >
        <SourceOrganizeDialog onClose={onClose} />
      </NotebookWorkspaceContext.Provider>
    </ApiProvider>,
  );
  return { onClose, workspaceUpdateSource };
}

describe('SourceOrganizeDialog', () => {
  it('preselects unorganized sources, suggests for the selection, and applies edits', async () => {
    const suggestExistingSourceOrganization = vi.fn<ApiClient['suggestExistingSourceOrganization']>(
      () =>
        Promise.resolve({
          suggestions: [{ sourceId: gossip.id, category: 'lore', tags: ['rumors', 'harbor'] }],
          warning: null,
        }),
    );
    const updateSource = vi.fn<ApiClient['updateSource']>((_id, patch) =>
      Promise.resolve(detailFor(gossip, patch as { category: unknown; tags: string[] })),
    );
    const { onClose, workspaceUpdateSource } = renderDialog([charter, gossip], {
      suggestExistingSourceOrganization,
      updateSource,
    });

    expect(screen.getByRole('checkbox', { name: /Gossip/u })).toHaveProperty('checked', true);
    expect(screen.getByRole('checkbox', { name: /Charter/u })).toHaveProperty('checked', false);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Suggest organization' }));
    expect(suggestExistingSourceOrganization).toHaveBeenCalledWith(
      notebook.id,
      { sourceIds: [gossip.id] },
      expect.any(AbortSignal),
    );

    const category = await screen.findByLabelText('Category for Gossip');
    await waitFor(() => expect(category).toHaveProperty('value', 'lore'));
    expect(screen.getByLabelText('Tags for Gossip')).toHaveProperty('value', 'rumors, harbor');

    await user.click(screen.getByRole('button', { name: 'Apply to 1 source' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(updateSource).toHaveBeenCalledWith(gossip.id, {
      category: 'lore',
      tags: ['rumors', 'harbor'],
    });
    expect(workspaceUpdateSource).toHaveBeenCalledWith(
      expect.objectContaining({ id: gossip.id, category: 'lore', tags: ['rumors', 'harbor'] }),
    );
  });

  it('keeps saved organization, merges suggested tags, and skips unchanged sources', async () => {
    const suggestExistingSourceOrganization = vi.fn<ApiClient['suggestExistingSourceOrganization']>(
      () =>
        Promise.resolve({
          suggestions: [
            { sourceId: charter.id, category: null, tags: ['iron-compact', 'smugglers'] },
            { sourceId: gossip.id, category: null, tags: [] },
          ],
          warning: null,
        }),
    );
    const updateSource = vi.fn<ApiClient['updateSource']>((_id, patch) =>
      Promise.resolve(detailFor(charter, patch as { category: unknown; tags: string[] })),
    );
    const { onClose } = renderDialog([charter, gossip], {
      suggestExistingSourceOrganization,
      updateSource,
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox', { name: /Charter/u }));
    await user.click(screen.getByRole('button', { name: 'Suggest organization' }));

    // A blank suggested category never clears the saved one, and suggested
    // tags extend the saved list instead of replacing it.
    const category = await screen.findByLabelText('Category for Charter');
    expect(category).toHaveProperty('value', 'factions');
    await waitFor(() =>
      expect(screen.getByLabelText('Tags for Charter')).toHaveProperty(
        'value',
        'iron-compact, smugglers',
      ),
    );

    await user.click(screen.getByRole('button', { name: 'Apply to 2 sources' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    // Gossip received a blank suggestion, so it is unchanged and not patched.
    expect(updateSource).toHaveBeenCalledExactlyOnceWith(charter.id, {
      category: 'factions',
      tags: ['iron-compact', 'smugglers'],
    });
  });

  it('falls back to manual organization with a warning when the suggestion fails', async () => {
    const { onClose } = renderDialog([charter, gossip], {
      suggestExistingSourceOrganization: () => Promise.reject(new Error('provider down')),
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Suggest organization' }));
    await screen.findByText("Couldn't suggest organization. You can choose it manually.");
    expect(screen.getByLabelText('Category for Gossip')).toHaveProperty('value', '');

    // Nothing changed, so applying patches nothing and simply closes.
    await user.click(screen.getByRole('button', { name: 'Apply to 1 source' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('reports sources that fail to save and stays open for a retry', async () => {
    const suggestExistingSourceOrganization = vi.fn<ApiClient['suggestExistingSourceOrganization']>(
      () =>
        Promise.resolve({
          suggestions: [{ sourceId: gossip.id, category: 'lore', tags: ['rumors'] }],
          warning: null,
        }),
    );
    const { onClose } = renderDialog([charter, gossip], {
      suggestExistingSourceOrganization,
      updateSource: () => Promise.reject(new Error('disk full')),
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Suggest organization' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Category for Gossip')).toHaveProperty('value', 'lore'),
    );
    await user.click(screen.getByRole('button', { name: 'Apply to 1 source' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Gossip');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('caps a single pass at the batch limit', async () => {
    const many = Array.from({ length: 101 }, (_, index) =>
      source(`33333333-3333-4333-8333-3333333${String(index).padStart(5, '0')}`, `Entry ${index}`),
    );
    renderDialog(many, {});
    expect(screen.getByRole('alert').textContent).toContain('up to 100 sources');
    expect(screen.getByRole('button', { name: 'Suggest organization' })).toHaveProperty(
      'disabled',
      true,
    );
  });
});
