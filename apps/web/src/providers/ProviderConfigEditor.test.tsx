import type { ProviderCatalogEntry } from '@worldbookllm/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { ApiProvider } from '../api/ApiContext.js';
import { ApiClientError } from '../api/client.js';
import { createTestClient } from '../test/createTestClient.js';
import { ProviderConfigEditor } from './ProviderConfigEditor.js';

const catalog: ProviderCatalogEntry[] = [
  {
    source: 'claude',
    label: 'Anthropic',
    family: 'dedicated',
    secretKey: 'api_key_claude',
    modelSource: 'live',
    hasSecret: true,
  },
  {
    source: 'custom',
    label: 'Custom OpenAI',
    family: 'openai-compat',
    secretKey: 'api_key_custom',
    needsBaseUrl: true,
    modelSource: 'live',
    hasSecret: false,
  },
  {
    source: 'azure_openai',
    label: 'Azure OpenAI',
    family: 'openai-compat',
    secretKey: 'api_key_azure_openai',
    needsBaseUrl: true,
    modelSource: 'static',
    extraFields: [
      {
        key: 'deployment',
        label: 'Deployment',
        required: true,
      },
      {
        key: 'apiVersion',
        label: 'API version',
        required: true,
        options: ['2025-01-01', '2026-01-01'],
      },
    ],
    hasSecret: true,
  },
];

function renderEditor(overrides = {}, onSubmit = vi.fn()) {
  render(
    <ApiProvider client={createTestClient(overrides)}>
      <MemoryRouter>
        <ProviderConfigEditor catalog={catalog} initial={null} onSubmit={onSubmit} />
      </MemoryRouter>
    </ApiProvider>,
  );
  return onSubmit;
}

describe('ProviderConfigEditor', () => {
  it('renders catalog descriptors and submits a wire-valid complete configuration', async () => {
    const onSubmit = renderEditor();
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText('Provider'), 'azure_openai');
    expect(screen.getByLabelText('Base URL')).toBeDefined();
    expect(screen.getByLabelText('Deployment')).toBeDefined();
    expect(screen.getByLabelText('API version')).toBeDefined();
    await user.type(screen.getByLabelText('Base URL'), 'https://example.azure.com');
    await user.type(screen.getByLabelText('Deployment'), 'fiction');
    await user.selectOptions(screen.getByLabelText('API version'), '2026-01-01');
    await user.type(screen.getByLabelText('Model'), 'gpt-story');
    await user.click(screen.getByRole('button', { name: 'Save provider' }));

    expect(onSubmit).toHaveBeenCalledWith({
      source: 'azure_openai',
      baseUrl: 'https://example.azure.com',
      extra: { deployment: 'fiction', apiVersion: '2026-01-01' },
      model: 'gpt-story',
    });
  });

  it('loads models and clears dependent values when the provider changes', async () => {
    const listModels = vi.fn().mockResolvedValue({
      models: [{ id: 'claude-story', name: 'Claude Story' }],
    });
    renderEditor({ listModels });
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText('Provider'), 'claude');
    await user.type(screen.getByLabelText('Model'), 'old-model');
    await user.click(screen.getByRole('button', { name: 'Load models' }));

    expect(await screen.findByRole('option', { name: 'Claude Story (claude-story)' })).toBeDefined();
    expect(listModels).toHaveBeenCalledWith({ source: 'claude' }, expect.any(AbortSignal));
    await user.selectOptions(screen.getByLabelText('Provider'), 'custom');
    expect(screen.getByLabelText('Base URL')).toHaveProperty('value', '');
    expect(screen.getByLabelText('Model')).toHaveProperty('value', '');
  });

  it('falls back to manual model entry and keeps saving available after safe failures', async () => {
    const listModels = vi
      .fn()
      .mockRejectedValue(new ApiClientError(502, 'provider_error', 'Provider unavailable.'));
    const testConnection = vi
      .fn()
      .mockRejectedValue(new ApiClientError(502, 'provider_error', 'Connection rejected.'));
    const onSubmit = renderEditor({ listModels, testConnection });
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText('Provider'), 'claude');
    await user.click(screen.getByRole('button', { name: 'Load models' }));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Provider unavailable.',
    );
    await user.type(screen.getByLabelText('Model'), 'manual-model');
    await user.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText('Connection rejected.')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Save provider' }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({ source: 'claude', model: 'manual-model' }),
    );
  });
});
