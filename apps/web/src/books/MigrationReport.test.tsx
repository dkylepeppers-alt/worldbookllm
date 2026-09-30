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
  archivePath: null,
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
    expect(region.textContent).toContain('1 of your 2 notebooks have moved into books');
    expect(region.textContent).toContain('stay in data/notebooks/ until every notebook has moved');
    expect(screen.getByRole('link', { name: 'Harbor Lore' }).getAttribute('href')).toBe(
      '/books/harbor-lore',
    );
    expect(region.textContent).toContain('2 research notes of 3 sources · 1 chat');
    expect(region.textContent).toContain(
      'Not moved yet; tried again when the server next starts: story import failed',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('region', { name: 'Notebooks moved into books' })).toBeNull();
    await waitFor(() => expect(markNotebookMigrationSeen).toHaveBeenCalledTimes(1));
  });

  it('names the folder the originals were archived to', async () => {
    renderReport({
      getNotebookMigration: () =>
        Promise.resolve({
          ...report,
          entries: report.entries.slice(0, 1),
          archivePath: 'notebooks.migrated-2026-09-30T12-00-00.000Z',
        }),
    });
    const region = await screen.findByRole('region', { name: 'Notebooks moved into books' });
    expect(region.textContent).toContain('Your 1 notebook is now a book.');
    expect(region.textContent).toContain(
      'kept in data/notebooks.migrated-2026-09-30T12-00-00.000Z/',
    );
  });

  it('stays hidden once seen or when nothing moved', async () => {
    const getNotebookMigration = vi.fn().mockResolvedValue({ ...report, seen: true });
    renderReport({ getNotebookMigration });
    await waitFor(() => expect(getNotebookMigration).toHaveBeenCalled());
    expect(screen.queryByRole('region', { name: 'Notebooks moved into books' })).toBeNull();
  });
});
