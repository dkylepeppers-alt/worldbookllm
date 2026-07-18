import type { Chat, Preset } from '@worldbookllm/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ApiProvider } from '../api/ApiContext.js';
import { createTestClient } from '../test/createTestClient.js';
import { PresetControls } from './PresetControls.js';

const preset: Preset = {
  id: '73a30f4e-d17c-468c-9e73-a0f9a59732a5',
  schemaVersion: 1,
  name: 'Grounded development',
  generation: { temperature: 0.7, topP: null, maxTokens: 1024, assistantPrefill: null },
  modules: [
    {
      key: 'sources',
      name: 'Selected sources',
      kind: 'sources',
      role: 'system',
      content: null,
      enabled: true,
      insertion: { position: 'before_history' },
    },
  ],
  createdAt: '2026-07-10T12:00:00.000Z',
  updatedAt: '2026-07-10T12:00:00.000Z',
};

const chat: Chat = {
  id: '60a0bf0c-031d-497c-9c1a-2f68441936a6',
  notebookId: 'a0c7607c-b365-438b-a7e6-31b2308464b6',
  title: 'Chat',
  sourceIds: [],
  skillIds: [],
  presetId: null,
  createdAt: '2026-07-10T12:00:00.000Z',
  updatedAt: '2026-07-10T12:00:00.000Z',
};

describe('PresetControls thinking toggle', () => {
  it('patches the preset generation when toggled on', async () => {
    const updatePreset = vi.fn((_id: string, input: { generation?: object }) =>
      Promise.resolve({
        ...preset,
        generation: { ...preset.generation, ...input.generation },
      } as Preset),
    );
    const client = createTestClient({
      listPresets: () => Promise.resolve([preset]),
      getAppSettings: () => Promise.resolve({ defaultPresetId: preset.id, providerConfig: null }),
      updatePreset,
    });
    render(
      <ApiProvider client={client}>
        <PresetControls
          chat={chat}
          presetLibraryRevision={0}
          onChatUpdated={vi.fn()}
          onPresetUpdated={vi.fn()}
          onMutationBusyChange={vi.fn()}
        />
      </ApiProvider>,
    );

    const checkbox = await screen.findByRole('checkbox', { name: 'Extended thinking' });
    expect(checkbox).toHaveProperty('checked', false);
    await userEvent.setup().click(checkbox);
    await waitFor(() =>
      expect(updatePreset).toHaveBeenCalledWith(preset.id, {
        generation: { thinking: true },
      }),
    );
  });
});
