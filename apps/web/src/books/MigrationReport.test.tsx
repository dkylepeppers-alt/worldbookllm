import type { NotebookMigrationReport } from '@worldbookllm/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { ApiProvider } from '../api/ApiContext.js';
import { createTestClient } from '../test/createTestClient.js';
import { MigrationReport } from './MigrationReport.js';

const report: NotebookMigrationReport = {
  seen: false,
  entries: [
    {
      notebookName: 'Harbor Lore',
      bookSlug: 'harbor-lore',
      migratedAt: '2026-09-30T12:00:00.000Z',
      sourceCount: 3,
      fileCount: 2,
      chatCount: 1,
      error: null,
    },
    {
      notebookName: 'Damaged',
      bookSlug: 'damaged',
      migratedAt: '2026-09-30T12:00:00.000Z',
      sourceCount: 1,
      fileCount: 0,
      chatCount: 0,
      error: 'story import failed',
    },
  ],
};

function renderReport(overrides = {}) {
  render(
    <ApiProvider client={createTestClient(overrides)}>
      <MemoryRouter>
        <MigrationReport />
      </MemoryRouter>
    </ApiProvider>,
  );
}

describe('MigrationReport', () => {
  it('lists the moved notebooks until dismissed', async () => {
    const markNotebookMigrationSeen = vi.fn().mockResolvedValue(undefined);
    renderReport({
      getNotebookMigration: () => Promise.resolve(report),
      markNotebookMigrationSeen,
    });

    const region = await screen.findByRole('region', { name: 'Notebooks moved into books' });
    expect(region.textContent).toContain('2 notebooks are now books');
    expect(screen.getByRole('link', { name: 'Harbor Lore' }).getAttribute('href')).toBe(
      '/books/harbor-lore',
    );
    expect(region.textContent).toContain('2 research notes of 3 sources · 1 chat');
    expect(region.textContent).toContain('Its sources could not be written: story import failed');

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('region', { name: 'Notebooks moved into books' })).toBeNull();
    await waitFor(() => expect(markNotebookMigrationSeen).toHaveBeenCalledTimes(1));
  });

  it('stays hidden once seen or when nothing moved', async () => {
    const getNotebookMigration = vi.fn().mockResolvedValue({ ...report, seen: true });
    renderReport({ getNotebookMigration });
    await waitFor(() => expect(getNotebookMigration).toHaveBeenCalled());
    expect(screen.queryByRole('region', { name: 'Notebooks moved into books' })).toBeNull();
  });
});
