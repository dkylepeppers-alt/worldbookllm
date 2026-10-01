import type { BookSummary, SeriesHealth, SeriesSummary } from '@worldbookllm/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { AppRoutes } from '../App.js';
import { ApiProvider } from '../api/ApiContext.js';
import { createTestClient } from '../test/createTestClient.js';

const bible: BookSummary = {
  slug: 'tides',
  title: 'Tides',
  kind: 'series-bible',
  seriesId: 'tides',
  genre: null,
  status: null,
  bookNumber: null,
  follows: [],
  precedes: [],
  counts: {},
  updatedAt: '2026-09-30T00:00:00.000Z',
};
const book: BookSummary = {
  ...bible,
  slug: 'low-water',
  title: 'Low Water',
  kind: 'book',
  bookNumber: 1,
};
const series: SeriesSummary = { id: 'tides', bible, books: [book] };
const health: SeriesHealth = {
  series: {
    command: 'series',
    exitCode: 0,
    envelope: {
      apiVersion: 'story/v2',
      command: 'series',
      ok: true,
      data: {},
      diagnostics: [],
    },
  },
  links: [
    {
      book: 'low-water',
      result: {
        command: 'links',
        exitCode: 1,
        envelope: {
          apiVersion: 'story/v2',
          command: 'links',
          ok: false,
          data: {},
          diagnostics: [{ severity: 'error', message: 'Missing backlink', file: 'story.md' }],
        },
      },
    },
  ],
  drift: [
    {
      entity: { kind: 'character', id: 'mira' },
      book: 'low-water',
      fields: ['aliases', 'body:Appearance'],
    },
  ],
};

describe('Series screen', () => {
  it('carries a selected bible entity into a book from the overview', async () => {
    const user = userEvent.setup();
    let carried = false;
    const client = createTestClient({
      getSeries: async () => series,
      getSeriesHealth: async () => health,
      getBookTree: async () => ({
        book: bible,
        files: [
          {
            path: 'characters/mira.md',
            kind: 'character',
            entityId: 'mira',
            title: 'Mira',
            hash: 'a'.repeat(64),
            size: 1,
            updatedAt: bible.updatedAt,
          },
        ],
      }),
      syncSeries: async (_id, input) => {
        expect(input).toEqual({
          direction: 'carry',
          entity: { kind: 'character', id: 'mira' },
          book: 'low-water',
        });
        carried = true;
        return { checkpoints: [] };
      },
    });
    render(
      <ApiProvider client={client}>
        <MemoryRouter initialEntries={['/series/tides']}>
          <AppRoutes />
        </MemoryRouter>
      </ApiProvider>,
    );
    await user.selectOptions(await screen.findByLabelText('Bible entity'), 'character:mira');
    await user.selectOptions(screen.getByLabelText('Carry into book'), 'low-water');
    await user.click(screen.getByRole('button', { name: 'Carry entity' }));
    expect(carried).toBe(true);
  });
  it('pushes a drift row and refreshes the canon report', async () => {
    const user = userEvent.setup();
    let pushed = false;
    const client = createTestClient({
      getSeries: async () => series,
      getSeriesHealth: async () => (pushed ? { ...health, drift: [] } : health),
      syncSeries: async (id, input) => {
        expect(id).toBe('tides');
        expect(input).toEqual({
          direction: 'push',
          entity: { kind: 'character', id: 'mira' },
          books: ['low-water'],
        });
        pushed = true;
        return { checkpoints: [] };
      },
    });
    render(
      <ApiProvider client={client}>
        <MemoryRouter initialEntries={['/series/tides']}>
          <AppRoutes />
        </MemoryRouter>
      </ApiProvider>,
    );
    await user.click(await screen.findByRole('button', { name: 'Push mira to low-water' }));
    expect(await screen.findByText('No canon drift in existing book copies.')).toBeTruthy();
  });
  it('shows style sheet drift by name and pulls the book’s style sheet into the bible', async () => {
    const user = userEvent.setup();
    let pulled = false;
    const styleSheet = { kind: 'style-sheet', id: 'style-sheet' } as const;
    const client = createTestClient({
      getSeries: async () => series,
      getSeriesHealth: async () => ({
        ...health,
        drift: pulled ? [] : [{ entity: styleSheet, book: 'low-water', fields: ['watch-words'] }],
      }),
      syncSeries: async (_id, input) => {
        expect(input).toEqual({ direction: 'pull', entity: styleSheet, book: 'low-water' });
        pulled = true;
        return { checkpoints: [] };
      },
    });
    render(
      <ApiProvider client={client}>
        <MemoryRouter initialEntries={['/series/tides']}>
          <AppRoutes />
        </MemoryRouter>
      </ApiProvider>,
    );
    const drift = await screen.findByRole('list', { name: 'Canon drift' });
    expect(drift.textContent).toContain('Style sheet');
    expect(drift.textContent).toContain('watch-words');
    await user.click(screen.getByRole('button', { name: 'Pull style-sheet from low-water' }));
    expect(await screen.findByText('No canon drift in existing book copies.')).toBeTruthy();
  });
  it('is reachable from the library and shows books, drift, and check findings', async () => {
    const user = userEvent.setup();
    const client = createTestClient({
      listBooks: async () => [bible, book],
      getSeries: async () => series,
      getSeriesHealth: async () => health,
    });
    render(
      <ApiProvider client={client}>
        <MemoryRouter initialEntries={['/books']}>
          <AppRoutes />
        </MemoryRouter>
      </ApiProvider>,
    );
    await user.click(await screen.findByRole('link', { name: 'Series overview' }));
    expect(await screen.findByRole('heading', { name: 'Tides' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Low Water' }).getAttribute('href')).toBe(
      '/books/low-water',
    );
    expect(screen.getByText('aliases, Appearance')).toBeTruthy();
    expect(screen.getByText('Missing backlink')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'story.md' }).getAttribute('href')).toBe(
      '/books/low-water/files/story.md',
    );
  });

  it('keeps book navigation available when health fails and offers a retry', async () => {
    let attempts = 0;
    const user = userEvent.setup();
    const client = createTestClient({
      getBookTree: async () => ({ book: bible, files: [] }),
      getSeries: async () => series,
      getSeriesHealth: async () => {
        if (attempts++ === 0) throw new Error('CLI unavailable');
        return { ...health, drift: [], links: [] };
      },
    });
    render(
      <ApiProvider client={client}>
        <MemoryRouter initialEntries={['/series/tides']}>
          <AppRoutes />
        </MemoryRouter>
      </ApiProvider>,
    );
    expect(await screen.findByText('CLI unavailable')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Low Water' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No canon drift in existing book copies.')).toBeTruthy();
  });
});
