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
