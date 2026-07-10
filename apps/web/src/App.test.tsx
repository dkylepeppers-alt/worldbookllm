import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { AppRoutes } from './App.js';
import { ApiProvider } from './api/ApiContext.js';
import type { ApiClient } from './api/client.js';

const unusedClient: ApiClient = {
  listNotebooks: () => Promise.resolve([]),
  createNotebook: () => Promise.reject(new Error('unused')),
  getNotebook: () => Promise.reject(new Error('unused')),
  updateNotebook: () => Promise.reject(new Error('unused')),
  deleteNotebook: () => Promise.reject(new Error('unused')),
  listSources: () => Promise.resolve([]),
  createSource: () => Promise.reject(new Error('unused')),
  getSource: () => Promise.reject(new Error('unused')),
  deleteSource: () => Promise.reject(new Error('unused')),
};

function renderRoute(path: string): void {
  render(
    <ApiProvider client={unusedClient}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </ApiProvider>,
  );
}

describe('application routes', () => {
  it('keeps the worldbook workspace landmark around settings', () => {
    renderRoute('/settings');

    expect(screen.getByRole('banner')).toBeDefined();
    expect(screen.getByRole('link', { name: 'worldbookllm' }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('heading', { name: 'Provider settings' })).toBeDefined();
    expect(screen.getByText(/arrive in phase 8/i)).toBeDefined();
    expect(getComputedStyle(document.documentElement).getPropertyValue('--ink').trim()).toBe(
      '#17212b',
    );
  });

  it('renders a useful not-found route', () => {
    renderRoute('/missing-map');

    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Return to notebooks' }).getAttribute('href')).toBe(
      '/',
    );
  });
});
