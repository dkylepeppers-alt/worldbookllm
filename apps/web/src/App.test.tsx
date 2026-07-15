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
    expect(screen.getByRole('link', { name: 'worldbookllm' }).getAttribute('href')).toBe('/');
    expect(await screen.findByRole('heading', { name: 'Provider settings' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe('/settings');
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

  it('exposes the preset studio as a top-level route', async () => {
    renderRoute('/presets');

    expect(screen.getByRole('link', { name: 'Presets' }).getAttribute('href')).toBe('/presets');
    expect(await screen.findByRole('heading', { name: 'Preset studio' })).toBeDefined();
  });

  it('renders the normative preset schema Markdown at its offline route', () => {
    renderRoute('/preset-schema');

    expect(screen.getByRole('heading', { name: 'Preset schema version 1' })).toBeDefined();
    expect(screen.getByText(/A preset must contain exactly one Sources module/)).toBeDefined();
    expect(screen.getByText(/Unknown fields are rejected/)).toBeDefined();
  });
});
