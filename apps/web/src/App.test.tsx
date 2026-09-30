import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { AppRoutes } from './App.js';
import { ApiProvider } from './api/ApiContext.js';
import { createTestClient } from './test/createTestClient.js';

function renderRoute(path: string): void {
  render(
    <ApiProvider client={createTestClient()}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </ApiProvider>,
  );
}

describe('application routes', () => {
  it('keeps the worldbook workspace landmark around settings', async () => {
    renderRoute('/settings');

    expect(screen.getByRole('banner')).toBeDefined();
    expect(screen.getByRole('link', { name: 'worldbookllm' }).getAttribute('href')).toBe('/books');
    expect(await screen.findByRole('heading', { name: 'Provider settings' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe('/settings');
    expect(getComputedStyle(document.documentElement).getPropertyValue('--ink').trim()).toBe(
      '#17212b',
    );
  });

  it('renders a useful not-found route', () => {
    renderRoute('/missing-map');

    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Return to books' }).getAttribute('href')).toBe(
      '/books',
    );
  });

  it('opens on the book library', async () => {
    renderRoute('/');

    expect(await screen.findByRole('heading', { name: 'Books', level: 1 })).toBeDefined();
    expect(screen.queryByRole('link', { name: 'Presets' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Notebooks' })).toBeNull();
  });

  it('no longer serves the retired notebook and preset routes', () => {
    renderRoute('/presets');

    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeDefined();
  });
});
