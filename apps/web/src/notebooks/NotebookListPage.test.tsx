import type { Notebook } from '@worldbookllm/shared';
import { act, render, screen, waitFor } from '@testing-library/react';
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

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

function renderHome(client = createTestClient()) {
  return render(
    <ApiProvider client={client}>
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
        <LocationProbe />
      </MemoryRouter>
    </ApiProvider>,
  );
}

describe('NotebookListPage', () => {
  it('moves from a loading state to an actionable empty state', async () => {
    let resolveList: (value: Notebook[]) => void = () => undefined;
    const pending = new Promise<Notebook[]>((resolve) => {
      resolveList = resolve;
    });
    renderHome(createTestClient({ listNotebooks: () => pending }));

    expect(screen.getByText(/charting notebooks/i)).toBeDefined();
    await act(() => {
      resolveList([]);
      return pending;
    });

    expect(screen.getByRole('heading', { name: 'Begin a worldbook' })).toBeDefined();
    expect(screen.getByRole('textbox', { name: 'Notebook name' })).toBeDefined();
  });

  it('renders notebook destinations with useful metadata', async () => {
    renderHome(createTestClient({ listNotebooks: () => Promise.resolve([notebook]) }));

    expect(await screen.findByRole('link', { name: notebook.name })).toBeDefined();
    expect(screen.getByText(/updated jul 10/i)).toBeDefined();
    expect(screen.getByRole('button', { name: `Rename ${notebook.name}` })).toBeDefined();
    expect(screen.getByRole('button', { name: `Delete ${notebook.name}` })).toBeDefined();
  });

  it('creates a notebook and enters its source workspace', async () => {
    const createNotebook = vi.fn().mockResolvedValue(notebook);
    renderHome(createTestClient({ createNotebook }));
    const user = userEvent.setup();

    await screen.findByRole('heading', { name: 'Begin a worldbook' });
    await user.type(screen.getByRole('textbox', { name: 'Notebook name' }), 'Atlas of Ember');
    await user.click(screen.getByRole('button', { name: 'Create notebook' }));

    await waitFor(() => expect(createNotebook).toHaveBeenCalledWith({ name: 'Atlas of Ember' }));
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(`/notebooks/${notebook.id}`),
    );
  });

  it('renames a notebook inline using the server response', async () => {
    const updateNotebook = vi.fn().mockResolvedValue({ ...notebook, name: 'Ember revised' });
    renderHome(
      createTestClient({ listNotebooks: () => Promise.resolve([notebook]), updateNotebook }),
    );
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: `Rename ${notebook.name}` }));
    const input = screen.getByRole('textbox', { name: `New name for ${notebook.name}` });
    await user.clear(input);
    await user.type(input, 'Ember revised');
    await user.click(screen.getByRole('button', { name: 'Save name' }));

    expect(updateNotebook).toHaveBeenCalledWith(notebook.id, { name: 'Ember revised' });
    expect(await screen.findByRole('link', { name: 'Ember revised' })).toBeDefined();
  });

  it('requires confirmation before deleting a notebook', async () => {
    const deleteNotebook = vi.fn().mockResolvedValue(undefined);
    renderHome(
      createTestClient({ listNotebooks: () => Promise.resolve([notebook]), deleteNotebook }),
    );
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: `Delete ${notebook.name}` }));
    expect(screen.getByRole('dialog', { name: 'Delete notebook?' })).toBeDefined();
    expect(deleteNotebook).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Delete notebook' }));

    await waitFor(() => expect(deleteNotebook).toHaveBeenCalledWith(notebook.id));
    expect(screen.queryByRole('link', { name: notebook.name })).toBeNull();
  });

  it('closes the delete dialog and surfaces the error when deletion fails', async () => {
    const deleteNotebook = vi
      .fn()
      .mockRejectedValue(new ApiClientError(500, 'internal_error', 'Internal server error'));
    renderHome(
      createTestClient({ listNotebooks: () => Promise.resolve([notebook]), deleteNotebook }),
    );
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: `Delete ${notebook.name}` }));
    await user.click(screen.getByRole('button', { name: 'Delete notebook' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Delete notebook?' })).toBeNull(),
    );
    expect(screen.getByRole('alert')).toHaveProperty('textContent', 'Internal server error');
    expect(screen.getByRole('link', { name: notebook.name })).toBeDefined();
  });

  it('disables cancelling while a deletion is in flight', async () => {
    const deleteNotebook = vi.fn().mockReturnValue(new Promise<never>(() => undefined));
    renderHome(
      createTestClient({ listNotebooks: () => Promise.resolve([notebook]), deleteNotebook }),
    );
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: `Delete ${notebook.name}` }));
    await user.click(screen.getByRole('button', { name: 'Delete notebook' }));

    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveProperty('disabled', true);
  });

  it('sends a single rename request when the save button is clicked twice', async () => {
    let resolveUpdate: (value: Notebook) => void = () => undefined;
    const updateNotebook = vi.fn().mockReturnValue(
      new Promise<Notebook>((resolve) => {
        resolveUpdate = resolve;
      }),
    );
    renderHome(
      createTestClient({ listNotebooks: () => Promise.resolve([notebook]), updateNotebook }),
    );
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: `Rename ${notebook.name}` }));
    const input = screen.getByRole('textbox', { name: `New name for ${notebook.name}` });
    await user.clear(input);
    await user.type(input, 'Ember revised');
    const save = screen.getByRole('button', { name: 'Save name' });
    await user.click(save);
    await user.click(save);

    expect(updateNotebook).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveUpdate({ ...notebook, name: 'Ember revised' });
    });
    expect(await screen.findByRole('link', { name: 'Ember revised' })).toBeDefined();
  });

  it('explains a load failure and retries it', async () => {
    const listNotebooks = vi
      .fn()
      .mockRejectedValueOnce(new ApiClientError(500, 'internal_error', 'Internal server error'))
      .mockResolvedValueOnce([]);
    renderHome(createTestClient({ listNotebooks }));
    const user = userEvent.setup();

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringMatching(/could not load notebooks/i),
    );
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('heading', { name: 'Begin a worldbook' })).toBeDefined();
    expect(listNotebooks).toHaveBeenCalledTimes(2);
  });
});
