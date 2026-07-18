import type { Message, Notebook, SourceMetadata } from '@worldbookllm/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { ApiProvider } from '../api/ApiContext.js';
import { ApiClientError } from '../api/client.js';
import { NotebookWorkspaceContext } from '../notebooks/notebook-workspace-context.js';
import { createTestClient } from '../test/createTestClient.js';
import { ResponseCaptureDialog } from './ResponseCaptureDialog.js';

const notebook: Notebook = {
  id: 'a0c7607c-b365-438b-a7e6-31b2308464b6',
  name: 'Atlas',
  createdAt: '2026-07-10T12:00:00.000Z',
  updatedAt: '2026-07-10T12:00:00.000Z',
};
const message: Message = {
  id: '3fdd7a3e-6d4e-4a56-a2a4-8b8a29f6d0cf',
  chatId: '60a0bf0c-031d-497c-9c1a-2f68441936a6',
  seq: 1,
  role: 'assistant',
  content: '# The Brass Coast\n\nFull answer.',
  reasoning: null,
  status: 'complete',
  context: null,
  createdAt: '2026-07-10T12:01:05.000Z',
};
const created: SourceMetadata = {
  id: 'b0c7607c-b365-438b-a7e6-31b2308464b6',
  notebookId: notebook.id,
  title: 'Edited title',
  slug: 'edited-title',
  filePath: 'notebooks/source.md',
  origin: { type: 'assistant-response', chatId: message.chatId, messageId: message.id },
  conversionNotes: [],
  category: null,
  tags: [],
  wordCount: 3,
  contentHash: 'a'.repeat(64),
  createdAt: '2026-07-10T12:02:00.000Z',
  updatedAt: '2026-07-10T12:02:00.000Z',
};

function LocationProbe() {
  return <p data-testid="location">{useLocation().pathname}</p>;
}

function renderDialog(overrides = {}, value: Message = message, onClose = vi.fn()) {
  const addSource = vi.fn();
  const setLastSourceId = vi.fn();
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
            addSource,
            updateSource: vi.fn(),
            removeSource: vi.fn(),
            replaceNotebook: vi.fn(),
            lastSourceId: null,
            setLastSourceId,
          }}
        >
          <ResponseCaptureDialog message={value} onClose={onClose} />
          <LocationProbe />
        </NotebookWorkspaceContext.Provider>
      </MemoryRouter>
    </ApiProvider>,
  );
  return { client, addSource, setLastSourceId, onClose };
}

describe('ResponseCaptureDialog', () => {
  it('prefills the derived title and full Markdown without warning for complete responses', () => {
    renderDialog();
    expect((screen.getByLabelText('Source title') as HTMLInputElement).value).toBe(
      'The Brass Coast',
    );
    expect((screen.getByLabelText('Markdown content') as HTMLTextAreaElement).value).toBe(
      message.content,
    );
    expect(screen.queryByText(/partial response/i)).toBeNull();
  });

  it.each(['interrupted', 'error'] as const)('warns when reviewing an %s response', (status) => {
    renderDialog({}, { ...message, status });
    expect(
      screen.getByText(status === 'interrupted' ? 'Interrupted response' : 'Errored response'),
    ).toBeDefined();
    expect(screen.getByText(/partial response/i)).toBeDefined();
  });

  it('saves exact edits with assistant provenance, closes, and navigates to the source', async () => {
    const suggestSourceOrganization = vi.fn().mockResolvedValue({
      suggestions: [{ index: 0, category: 'lore', tags: ['brass-coast'] }],
      warning: null,
    });
    const createSource = vi.fn().mockResolvedValue(created);
    const onClose = vi.fn();
    const { addSource, setLastSourceId } = renderDialog(
      { createSource, suggestSourceOrganization },
      message,
      onClose,
    );
    const user = userEvent.setup();
    await waitFor(() =>
      expect(suggestSourceOrganization).toHaveBeenCalledWith(
        notebook.id,
        {
          drafts: [
            {
              index: 0,
              title: 'The Brass Coast',
              content: message.content,
            },
          ],
        },
        expect.any(AbortSignal),
      ),
    );
    await user.clear(screen.getByLabelText('Source title'));
    await user.type(screen.getByLabelText('Source title'), '  Edited title  ');
    await user.clear(screen.getByLabelText('Markdown content'));
    await user.type(screen.getByLabelText('Markdown content'), 'Edited **Markdown**.');
    await user.selectOptions(screen.getByLabelText('Category'), 'places');
    await user.clear(screen.getByLabelText('Tags'));
    await user.type(screen.getByLabelText('Tags'), 'brass-coast, coastline');
    await user.click(screen.getByRole('button', { name: 'Save source' }));

    await waitFor(() =>
      expect(createSource).toHaveBeenCalledWith(notebook.id, {
        title: 'Edited title',
        content: 'Edited **Markdown**.',
        category: 'places',
        tags: ['brass-coast', 'coastline'],
        origin: { type: 'assistant-response', chatId: message.chatId, messageId: message.id },
        conversionNotes: [],
      }),
    );
    expect(addSource).toHaveBeenCalledWith(created);
    expect(setLastSourceId).toHaveBeenCalledWith(created.id);
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.getByTestId('location').textContent).toBe(
      `/notebooks/${notebook.id}/sources/${created.id}`,
    );
  });

  it('protects manual organization edits from a late suggestion', async () => {
    let resolveSuggestion!: (value: {
      suggestions: { index: number; category: 'lore'; tags: string[] }[];
      warning: null;
    }) => void;
    const suggestSourceOrganization = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveSuggestion = resolve;
      }),
    );
    renderDialog({ suggestSourceOrganization });
    const user = userEvent.setup();

    await waitFor(() => expect(suggestSourceOrganization).toHaveBeenCalledOnce());
    const save = screen.getByRole<HTMLButtonElement>('button', { name: 'Save source' });
    expect(save.disabled).toBe(true);
    await user.selectOptions(screen.getByLabelText('Category'), 'misc');
    resolveSuggestion({
      suggestions: [{ index: 0, category: 'lore', tags: ['brass-coast'] }],
      warning: null,
    });

    await waitFor(() => expect(save.disabled).toBe(false));
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Category' }).value).toBe(
      'misc',
    );
  });

  it('holds the review form busy while saving', async () => {
    const createSource = vi.fn(() => new Promise<SourceMetadata>(() => undefined));
    renderDialog({ createSource });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Save source' }));

    expect(
      ((await screen.findByRole('button', { name: 'Saving…' })) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByLabelText('Source title') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Markdown content') as HTMLTextAreaElement).disabled).toBe(true);
  });

  it('keeps edits open and reports API errors', async () => {
    const createSource = vi
      .fn()
      .mockRejectedValue(new ApiClientError(500, 'internal_error', 'The field notes tore.'));
    renderDialog({ createSource });
    const user = userEvent.setup();
    await user.clear(screen.getByLabelText('Source title'));
    await user.type(screen.getByLabelText('Source title'), 'Keep this title');
    await user.click(screen.getByRole('button', { name: 'Save source' }));

    expect((await screen.findByRole('alert')).textContent).toBe('The field notes tore.');
    expect((screen.getByLabelText('Source title') as HTMLInputElement).value).toBe(
      'Keep this title',
    );
    expect(screen.getByRole('dialog')).toBeDefined();
  });
});
