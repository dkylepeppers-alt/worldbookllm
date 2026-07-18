import type { MaskedSecret, ProviderCatalogEntry, SecretState } from '@worldbookllm/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { AppRoutes } from '../App.js';
import { ApiProvider } from '../api/ApiContext.js';
import { ApiClientError } from '../api/client.js';
import { createTestClient } from '../test/createTestClient.js';

const provider: ProviderCatalogEntry = {
  source: 'nanogpt',
  label: 'NanoGPT',
  family: 'openai-compat',
  secretKey: 'api_key_nanogpt',
  modelSource: 'live',
  hasSecret: true,
};

const activeSecret: MaskedSecret = {
  id: '17ffda6c-8021-4af4-87a5-a652bcdfddb7',
  value: 'sk-…last',
  label: 'Primary',
  active: true,
};

const standbySecret: MaskedSecret = {
  id: '3130ee6e-3e5f-4753-997d-0d7ca95bc86b',
  value: 'sk-…next',
  label: 'Standby',
  active: false,
};

function renderSettings(overrides = {}) {
  const client = createTestClient({
    getProviderCatalog: () => Promise.resolve([provider]),
    getSecrets: () =>
      Promise.resolve({
        [provider.secretKey]: [activeSecret, standbySecret],
      } satisfies SecretState),
    ...overrides,
  });
  render(
    <ApiProvider client={client}>
      <MemoryRouter initialEntries={['/settings']}>
        <AppRoutes />
      </MemoryRouter>
    </ApiProvider>,
  );
  return client;
}

describe('Provider settings', () => {
  it('renders masked keys and rotates and deletes them through confirmation', async () => {
    const activateSecret = vi.fn().mockResolvedValue(undefined);
    const deleteSecret = vi.fn().mockResolvedValue(undefined);
    renderSettings({ activateSecret, deleteSecret });
    const user = userEvent.setup();

    expect(await screen.findByRole('heading', { name: provider.label })).toBeDefined();
    expect(screen.getByText(activeSecret.value)).toBeDefined();
    expect(screen.getByText('Active')).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Make active' }));
    await waitFor(() =>
      expect(activateSecret).toHaveBeenCalledWith(provider.secretKey, standbySecret.id),
    );

    await user.click(
      screen.getByRole('button', { name: `Delete ${activeSecret.label} for ${provider.label}` }),
    );
    expect(screen.getByRole('dialog', { name: 'Delete provider key?' })).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Delete key' }));
    await waitFor(() =>
      expect(deleteSecret).toHaveBeenCalledWith(provider.secretKey, activeSecret.id),
    );
  });

  it('submits a write-only key and refreshes server state', async () => {
    const createSecret = vi.fn().mockResolvedValue(activeSecret);
    const getProviderCatalog = vi.fn().mockResolvedValue([provider]);
    const getSecrets = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ [provider.secretKey]: [activeSecret] });
    renderSettings({ createSecret, getProviderCatalog, getSecrets });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Add key' }));
    await user.type(screen.getByLabelText('Label (optional)'), 'Primary');
    const secretInput = screen.getByLabelText('Key value');
    await user.type(secretInput, 'sk-private-value');
    await user.click(screen.getByRole('button', { name: 'Save key' }));

    await waitFor(() =>
      expect(createSecret).toHaveBeenCalledWith({
        key: provider.secretKey,
        value: 'sk-private-value',
        label: 'Primary',
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Add provider key' })).toBeNull(),
    );
    expect(document.body.textContent).not.toContain('sk-private-value');
    expect(getProviderCatalog).toHaveBeenCalledTimes(2);
    expect(getSecrets).toHaveBeenCalledTimes(2);
  });

  it('configures, updates, and clears the global provider', async () => {
    const updateAppSettings = vi.fn().mockResolvedValue({
      defaultPresetId: '10000000-0000-4000-8000-000000000001',
      providerConfig: { source: 'nanogpt', model: 'nano-story' },
    });
    const getAppSettings = vi
      .fn()
      .mockResolvedValueOnce({
        defaultPresetId: '10000000-0000-4000-8000-000000000001',
        providerConfig: null,
      })
      .mockResolvedValue({
        defaultPresetId: '10000000-0000-4000-8000-000000000001',
        providerConfig: { source: 'nanogpt', model: 'nano-story' },
      });
    renderSettings({ getAppSettings, updateAppSettings });
    const user = userEvent.setup();

    expect(await screen.findByText('Not configured')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Configure provider' }));
    await user.selectOptions(await screen.findByLabelText('Provider'), 'nanogpt');
    await user.type(screen.getByLabelText('Model'), 'nano-story');
    await user.click(screen.getByRole('button', { name: 'Save provider' }));

    await waitFor(() =>
      expect(updateAppSettings).toHaveBeenCalledWith({
        providerConfig: { source: 'nanogpt', model: 'nano-story' },
      }),
    );
    expect(await screen.findByText('NanoGPT · nano-story')).toBeDefined();

    getAppSettings.mockResolvedValue({
      defaultPresetId: '10000000-0000-4000-8000-000000000001',
      providerConfig: null,
    });
    await user.click(screen.getByRole('button', { name: 'Configure provider' }));
    await user.click(await screen.findByRole('button', { name: 'Clear provider' }));
    await waitFor(() => expect(updateAppSettings).toHaveBeenCalledWith({ providerConfig: null }));
    expect(await screen.findByText('Not configured')).toBeDefined();
  });

  it('retries a catalog or secret load failure', async () => {
    const getProviderCatalog = vi
      .fn()
      .mockRejectedValueOnce(new ApiClientError(500, 'internal_error', 'Failed'))
      .mockResolvedValueOnce([provider]);
    renderSettings({ getProviderCatalog, getSecrets: () => Promise.resolve({}) });
    const user = userEvent.setup();

    expect(
      await screen.findByRole('heading', { name: 'Could not load provider settings' }),
    ).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('heading', { name: provider.label })).toBeDefined();
    expect(getProviderCatalog).toHaveBeenCalledTimes(2);
  });
});
