import {
  DEFAULT_AGENT_GENERATION,
  type AppSettings,
  type MaskedSecret,
  type ProviderCatalogEntry,
  type SecretState,
} from '@worldbookllm/shared';
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

  it('turns the agent review-mode default on', async () => {
    let reviewing = false;
    const settings = (): AppSettings => ({
      providerConfig: null,
      agentReviewMode: reviewing,
      agentGeneration: DEFAULT_AGENT_GENERATION,
    });
    const updateAppSettings = vi.fn((input: { agentReviewMode?: boolean }) => {
      reviewing = input.agentReviewMode ?? reviewing;
      return Promise.resolve(settings());
    });
    renderSettings({ getAppSettings: () => Promise.resolve(settings()), updateAppSettings });
    const toggle = await screen.findByRole('checkbox', {
      name: "Review the agent's changes before they apply",
    });
    expect((toggle as HTMLInputElement).checked).toBe(false);
    await userEvent.click(toggle);
    expect(updateAppSettings).toHaveBeenCalledWith({ agentReviewMode: true });
    await waitFor(() => expect((toggle as HTMLInputElement).checked).toBe(true));
  });

  it('saves the agent generation settings', async () => {
    let generation = { ...DEFAULT_AGENT_GENERATION };
    const settings = (): AppSettings => ({
      providerConfig: null,
      agentReviewMode: false,
      agentGeneration: generation,
    });
    const updateAppSettings = vi.fn((input: { agentGeneration?: typeof generation }) => {
      generation = input.agentGeneration ?? generation;
      return Promise.resolve(settings());
    });
    renderSettings({ getAppSettings: () => Promise.resolve(settings()), updateAppSettings });
    const user = userEvent.setup();

    const temperature = await screen.findByLabelText('Temperature');
    expect((temperature as HTMLInputElement).value).toBe('1');
    await user.clear(temperature);
    await user.type(temperature, '0.7');
    await user.type(screen.getByLabelText('Max tokens per step'), '2048');
    await user.click(screen.getByRole('checkbox', { name: /think before answering/ }));
    await user.click(screen.getByRole('button', { name: 'Save generation settings' }));

    await waitFor(() =>
      expect(updateAppSettings).toHaveBeenCalledWith({
        agentGeneration: { temperature: 0.7, topP: null, maxTokens: 2048, thinking: true },
      }),
    );
    expect(await screen.findByText('Saved.')).toBeDefined();
  });

  it('configures, updates, and clears the global provider', async () => {
    const updateAppSettings = vi.fn().mockResolvedValue({
      providerConfig: { source: 'nanogpt', model: 'nano-story' },
      agentReviewMode: false,
      agentGeneration: DEFAULT_AGENT_GENERATION,
    });
    const getAppSettings = vi
      .fn()
      .mockResolvedValueOnce({
        providerConfig: null,
        agentReviewMode: false,
        agentGeneration: DEFAULT_AGENT_GENERATION,
      })
      .mockResolvedValue({
        providerConfig: { source: 'nanogpt', model: 'nano-story' },
        agentReviewMode: false,
        agentGeneration: DEFAULT_AGENT_GENERATION,
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
      providerConfig: null,
      agentReviewMode: false,
      agentGeneration: DEFAULT_AGENT_GENERATION,
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
