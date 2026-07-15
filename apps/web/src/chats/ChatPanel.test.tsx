import type {
  Chat,
  ChatDetail,
  Message,
  Notebook,
  Preset,
  ProviderCatalogEntry,
  SourceMetadata,
} from '@worldbookllm/shared';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { AppRoutes } from '../App.js';
import { ApiProvider } from '../api/ApiContext.js';
import { ApiClientError } from '../api/client.js';
import { createScriptedStream, createTestClient } from '../test/createTestClient.js';

const notebook: Notebook = {
  id: 'a0c7607c-b365-438b-a7e6-31b2308464b6',
  name: 'Atlas of Ember',
  settings: { source: 'nanogpt', model: 'nano-story' },
  createdAt: '2026-07-10T12:00:00.000Z',
  updatedAt: '2026-07-10T12:00:00.000Z',
};

const provider: ProviderCatalogEntry = {
  source: 'nanogpt',
  label: 'NanoGPT',
  family: 'openai-compat',
  secretKey: 'api_key_nanogpt',
  modelSource: 'live',
  hasSecret: true,
};

const chat: Chat = {
  id: '60a0bf0c-031d-497c-9c1a-2f68441936a6',
  notebookId: notebook.id,
  title: 'First chat',
  sourceIds: [],
  providerOverride: null,
  presetId: null,
  createdAt: '2026-07-10T12:00:00.000Z',
  updatedAt: '2026-07-10T12:00:00.000Z',
};

const defaultPreset: Preset = {
  id: '10000000-0000-4000-8000-000000000001',
  schemaVersion: 1,
  name: 'Grounded atlas',
  generation: {
    temperature: 0.7,
    topP: 0.9,
    maxTokens: 2048,
    assistantPrefill: null,
  },
  modules: [
    {
      key: 'sources',
      name: 'Sources',
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

const prosePreset: Preset = {
  ...defaultPreset,
  id: '20000000-0000-4000-8000-000000000002',
  name: 'Prose draft',
  generation: { ...defaultPreset.generation, temperature: 1.1 },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const userMessage: Message = {
  id: '0d0f9d64-5c05-45a9-9a34-53e33a9c2b41',
  chatId: chat.id,
  seq: 0,
  role: 'user',
  content: 'Tell me about the coast.',
  reasoning: null,
  status: 'complete',
  context: null,
  createdAt: '2026-07-10T12:01:00.000Z',
};

const assistantMessage: Message = {
  id: '3fdd7a3e-6d4e-4a56-a2a4-8b8a29f6d0cf',
  chatId: chat.id,
  seq: 1,
  role: 'assistant',
  content: 'The coast is brass.',
  reasoning: null,
  status: 'complete',
  context: { sourceIds: [], provider: 'nanogpt', model: 'nano-story', strictness: 'grounded' },
  createdAt: '2026-07-10T12:01:05.000Z',
};

function detailWith(messages: Message[], sourceIds: string[] = []): ChatDetail {
  return { ...chat, sourceIds, messages };
}

async function renderWorkspace(overrides = {}, value: Notebook = notebook) {
  const client = createTestClient({
    getNotebook: () => Promise.resolve(value),
    listSources: () => Promise.resolve([]),
    getProviderCatalog: () => Promise.resolve([provider]),
    listChats: () => Promise.resolve([chat]),
    getChat: () => Promise.resolve(detailWith([])),
    listPresets: () => Promise.resolve([defaultPreset, prosePreset]),
    getAppSettings: () => Promise.resolve({ defaultPresetId: defaultPreset.id }),
    ...overrides,
  });
  render(
    <ApiProvider client={client}>
      <MemoryRouter initialEntries={[`/notebooks/${notebook.id}`]}>
        <AppRoutes />
      </MemoryRouter>
    </ApiProvider>,
  );
  // The chat region is behind the mobile Chat tab; jsdom applies only the
  // mobile-first base styles, so open it to make the panel visible in tests.
  fireEvent.click(await screen.findByRole('button', { name: 'Chat' }));
  return client;
}

describe('ChatPanel', () => {
  it('resolves and labels the inherited global default preset', async () => {
    await renderWorkspace();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: new RegExp(chat.title) }));

    const selector = await screen.findByLabelText('Chat preset');
    expect((selector as HTMLSelectElement).value).toBe('');
    expect(
      within(selector).getByRole('option', { name: 'Inherit global default — Grounded atlas' }),
    ).toBeDefined();
    expect(within(selector).getByRole('option', { name: 'Grounded atlas' })).toBeDefined();
    expect(within(selector).getByRole('option', { name: 'Prose draft' })).toBeDefined();
    expect(screen.getByText('Active preset: Grounded atlas')).toBeDefined();
    expect(screen.getByText('Inherited from global default')).toBeDefined();
    expect(screen.getByText(/shared global preset for every chat using it/i)).toBeDefined();
  });

  it('selects an explicit preset and can return to inheritance', async () => {
    const updateChat = vi
      .fn()
      .mockResolvedValueOnce({ ...chat, presetId: prosePreset.id })
      .mockResolvedValueOnce({ ...chat, presetId: null });
    await renderWorkspace({ updateChat });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: new RegExp(chat.title) }));
    const selector = await screen.findByLabelText('Chat preset');
    await user.selectOptions(selector, prosePreset.id);

    await waitFor(() =>
      expect(updateChat).toHaveBeenNthCalledWith(1, chat.id, { presetId: prosePreset.id }),
    );
    expect(await screen.findByText('Active preset: Prose draft')).toBeDefined();
    expect(screen.getByText('Explicit chat preset')).toBeDefined();

    await user.selectOptions(selector, '');
    await waitFor(() => expect(updateChat).toHaveBeenNthCalledWith(2, chat.id, { presetId: null }));
    expect(await screen.findByText('Active preset: Grounded atlas')).toBeDefined();
    expect(screen.getByText('Inherited from global default')).toBeDefined();
  });

  it('keeps the current preset selection when its PATCH fails', async () => {
    const explicit = { ...chat, presetId: prosePreset.id };
    const updateChat = vi
      .fn()
      .mockRejectedValue(new ApiClientError(500, 'internal_error', 'Preset route interrupted.'));
    await renderWorkspace({ listChats: () => Promise.resolve([explicit]), updateChat });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: new RegExp(chat.title) }));
    const selector = await screen.findByLabelText('Chat preset');
    expect((selector as HTMLSelectElement).value).toBe(prosePreset.id);
    await user.selectOptions(selector, defaultPreset.id);

    expect(await screen.findByText('Preset route interrupted.')).toBeDefined();
    expect((selector as HTMLSelectElement).value).toBe(prosePreset.id);
    expect(screen.getByText('Active preset: Prose draft')).toBeDefined();
    expect(updateChat).toHaveBeenCalledTimes(1);
  });

  it('holds Send during preset selection and adopts the successful PATCH result', async () => {
    const updating = deferred<Chat>();
    const updateChat = vi.fn().mockReturnValue(updating.promise);
    await renderWorkspace({ updateChat });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: new RegExp(chat.title) }));
    const selector = await screen.findByLabelText('Chat preset');
    await user.selectOptions(selector, prosePreset.id);

    expect((selector as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
    updating.resolve({ ...chat, presetId: prosePreset.id });

    expect(await screen.findByText('Active preset: Prose draft')).toBeDefined();
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('rolls preset selection back and unlocks Send when its PATCH fails', async () => {
    const updating = deferred<Chat>();
    const updateChat = vi.fn().mockReturnValue(updating.promise);
    await renderWorkspace({ updateChat });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: new RegExp(chat.title) }));
    const selector = await screen.findByLabelText('Chat preset');
    await user.selectOptions(selector, prosePreset.id);
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);

    updating.reject(new ApiClientError(500, 'internal_error', 'Preset route interrupted.'));
    expect(await screen.findByText('Preset route interrupted.')).toBeDefined();
    expect((selector as HTMLSelectElement).value).toBe('');
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('keeps Send locked for preset mutation B when stale mutation A settles after unmount', async () => {
    const secondChat: Chat = {
      ...chat,
      id: '70a0bf0c-031d-497c-9c1a-2f68441936a7',
      title: 'Second chat',
    };
    const updateA = deferred<Chat>();
    const updateB = deferred<Chat>();
    const updateChat = vi.fn((id: string) => (id === chat.id ? updateA.promise : updateB.promise));
    await renderWorkspace({
      listChats: () => Promise.resolve([chat, secondChat]),
      getChat: (id: string) =>
        Promise.resolve({ ...(id === chat.id ? chat : secondChat), messages: [] }),
      updateChat,
    });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: new RegExp(chat.title) }));
    await user.selectOptions(await screen.findByLabelText('Chat preset'), prosePreset.id);
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);

    await user.click(screen.getByRole('button', { name: new RegExp(secondChat.title) }));
    const secondSelector = await screen.findByLabelText('Chat preset');
    await user.selectOptions(secondSelector, prosePreset.id);
    expect(updateChat).toHaveBeenCalledTimes(2);
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      updateA.resolve({ ...chat, presetId: prosePreset.id });
      await updateA.promise;
    });
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      updateB.resolve({ ...secondChat, presetId: prosePreset.id });
      await updateB.promise;
    });
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
  });

  it('retains an in-flight temperature owner across chats until its PATCH settles and refreshes the shared preset', async () => {
    const secondChat: Chat = {
      ...chat,
      id: '80a0bf0c-031d-497c-9c1a-2f68441936a8',
      title: 'Second shared-preset chat',
    };
    const updating = deferred<Preset>();
    const returned = {
      ...defaultPreset,
      generation: { ...defaultPreset.generation, temperature: 1.25 },
      updatedAt: '2026-07-10T12:03:00.000Z',
    };
    let persisted = defaultPreset;
    const listPresets = vi.fn(() => Promise.resolve([persisted, prosePreset]));
    const updatePreset = vi.fn(() => updating.promise);
    await renderWorkspace({
      listChats: () => Promise.resolve([chat, secondChat]),
      getChat: (id: string) =>
        Promise.resolve({ ...(id === chat.id ? chat : secondChat), messages: [] }),
      listPresets,
      updatePreset,
    });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: new RegExp(chat.title) }));
    fireEvent.change(await screen.findByLabelText('Temperature'), {
      target: { value: '1.25' },
    });
    await waitFor(() => expect(updatePreset).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: new RegExp(secondChat.title) }));
    await screen.findByRole('heading', { name: secondChat.title, level: 3 });
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);

    persisted = returned;
    await act(async () => {
      updating.resolve(returned);
      await updating.promise;
    });

    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    expect(await screen.findByText('1.25')).toBeDefined();
    expect(listPresets).toHaveBeenCalledTimes(3);
  });

  it('keeps explicit preset controls available and retries only failed app settings', async () => {
    const explicit = { ...chat, presetId: prosePreset.id };
    const listPresets = vi.fn().mockResolvedValue([defaultPreset, prosePreset]);
    const getAppSettings = vi
      .fn()
      .mockRejectedValueOnce(new ApiClientError(500, 'internal_error', 'Failed'))
      .mockResolvedValueOnce({ defaultPresetId: defaultPreset.id });
    await renderWorkspace({
      listChats: () => Promise.resolve([explicit]),
      listPresets,
      getAppSettings,
    });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: new RegExp(chat.title) }));
    expect(await screen.findByText('Active preset: Prose draft')).toBeDefined();
    expect(screen.getByText('Explicit chat preset')).toBeDefined();
    expect(screen.getByText('Could not load the global default preset.')).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Retry global default' }));

    expect(await screen.findByText('Inherit global default — Grounded atlas')).toBeDefined();
    expect(screen.queryByText('Could not load the global default preset.')).toBeNull();
    expect(getAppSettings).toHaveBeenCalledTimes(2);
    expect(listPresets).toHaveBeenCalledTimes(1);
  });

  it('retains app settings and retries only a failed preset library', async () => {
    const listPresets = vi
      .fn()
      .mockRejectedValueOnce(new ApiClientError(500, 'internal_error', 'Failed'))
      .mockResolvedValueOnce([defaultPreset, prosePreset]);
    const getAppSettings = vi.fn().mockResolvedValue({ defaultPresetId: defaultPreset.id });
    await renderWorkspace({ listPresets, getAppSettings });
    const user = userEvent.setup();

    expect(await screen.findByRole('button', { name: new RegExp(chat.title) })).toBeDefined();
    await user.click(screen.getByRole('button', { name: new RegExp(chat.title) }));
    expect(await screen.findByText('Could not load the preset library.')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Retry preset library' }));

    expect(await screen.findByLabelText('Chat preset')).toBeDefined();
    expect(screen.queryByText('Could not load the preset library.')).toBeNull();
    expect(listPresets).toHaveBeenCalledTimes(2);
    expect(getAppSettings).toHaveBeenCalledTimes(1);
  });

  it('patches only temperature, adopts server controls, and holds Send until save settles', async () => {
    let resolveUpdate: (value: Preset) => void = () => undefined;
    const returned = {
      ...defaultPreset,
      generation: {
        temperature: 1.2,
        topP: 0.4,
        maxTokens: 8192,
        assistantPrefill: 'Server canonical prefill',
      },
      updatedAt: '2026-07-10T12:02:00.000Z',
    };
    const updatePreset = vi.fn(
      () =>
        new Promise<Preset>((resolve) => {
          resolveUpdate = resolve;
        }),
    );
    await renderWorkspace({ updatePreset });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: new RegExp(chat.title) }));
    const temperature = await screen.findByLabelText('Temperature');
    vi.useFakeTimers();
    try {
      fireEvent.change(temperature, { target: { value: '0.8' } });
      fireEvent.change(temperature, { target: { value: '1' } });
      fireEvent.change(temperature, { target: { value: '1.25' } });

      expect((temperature as HTMLInputElement).value).toBe('1.25');
      expect((temperature as HTMLInputElement).disabled).toBe(false);
      expect(updatePreset).not.toHaveBeenCalled();
      expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(
        true,
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(updatePreset).toHaveBeenCalledWith(defaultPreset.id, {
        generation: { temperature: 1.25 },
      });
      expect(updatePreset).toHaveBeenCalledTimes(1);
      expect((temperature as HTMLInputElement).disabled).toBe(true);
      expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(
        true,
      );
      expect(screen.getByText('Saving…')).toBeDefined();

      await act(async () => {
        resolveUpdate(returned);
        await Promise.resolve();
      });
      expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(
        false,
      );
      expect((screen.getByLabelText('Temperature') as HTMLInputElement).value).toBe('1.2');
      expect(screen.getByText('1.2')).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels a staged temperature save when the range returns to the persisted value', async () => {
    const updatePreset = vi.fn();
    await renderWorkspace({ updatePreset });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: new RegExp(chat.title) }));
    const temperature = await screen.findByLabelText('Temperature');
    vi.useFakeTimers();
    try {
      fireEvent.change(temperature, { target: { value: '0.8' } });
      fireEvent.change(temperature, { target: { value: '0.7' } });

      expect((temperature as HTMLInputElement).value).toBe('0.7');
      expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(
        false,
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(updatePreset).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rolls temperature back and reports a failed save', async () => {
    const updatePreset = vi
      .fn()
      .mockRejectedValue(new ApiClientError(500, 'internal_error', 'Temperature was not saved.'));
    await renderWorkspace({ updatePreset });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: new RegExp(chat.title) }));
    const temperature = await screen.findByLabelText('Temperature');
    fireEvent.change(temperature, { target: { value: '1.25' } });

    expect(await screen.findByText('Temperature was not saved.')).toBeDefined();
    expect((screen.getByLabelText('Temperature') as HTMLInputElement).value).toBe('0.7');
    expect(screen.getByText('Active preset: Grounded atlas')).toBeDefined();
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('creates, selects, renames, and deletes chats', async () => {
    const created = { ...chat, title: 'New chat' };
    const renamed = { ...created, title: 'Revised chat' };
    const createChat = vi.fn().mockResolvedValue(created);
    const updateChat = vi.fn().mockResolvedValue(renamed);
    const deleteChat = vi.fn().mockResolvedValue(undefined);
    const listChats = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await renderWorkspace({ createChat, updateChat, deleteChat, listChats });
    const user = userEvent.setup();

    expect(await screen.findByText('No chats yet.')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'New chat' }));
    expect(createChat).toHaveBeenCalledWith(notebook.id, {});
    expect(await screen.findByRole('heading', { name: created.title, level: 3 })).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Rename' }));
    const title = screen.getByLabelText('Chat title');
    await user.clear(title);
    await user.type(title, renamed.title);
    await user.click(screen.getByRole('button', { name: 'Save title' }));
    await waitFor(() => expect(updateChat).toHaveBeenCalledWith(chat.id, { title: renamed.title }));
    expect(await screen.findByRole('heading', { name: renamed.title, level: 3 })).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Delete chat' }));
    await waitFor(() => expect(deleteChat).toHaveBeenCalledWith(chat.id));
    expect(await screen.findByText('No chats yet.')).toBeDefined();
    expect(listChats).toHaveBeenCalledTimes(2);
  });

  it('persists notebook defaults and updates their visible summary', async () => {
    const unconfigured = { ...notebook, settings: null };
    const updateNotebook = vi.fn().mockResolvedValue(notebook);
    await renderWorkspace({ listChats: () => Promise.resolve([]), updateNotebook }, unconfigured);
    const user = userEvent.setup();

    expect(await screen.findByText('Not configured')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Configure provider' }));
    await user.selectOptions(await screen.findByLabelText('Provider'), 'nanogpt');
    await user.type(screen.getByLabelText('Model'), 'nano-story');
    await user.click(screen.getByRole('button', { name: 'Save provider' }));

    await waitFor(() =>
      expect(updateNotebook).toHaveBeenCalledWith(notebook.id, {
        settings: { source: 'nanogpt', model: 'nano-story' },
      }),
    );
    expect(await screen.findByText('NanoGPT · nano-story')).toBeDefined();
  });

  it('sets and clears a complete chat provider override', async () => {
    const overridden = {
      ...chat,
      providerOverride: { source: 'nanogpt' as const, model: 'override-model' },
    };
    const updateChat = vi
      .fn()
      .mockResolvedValueOnce(overridden)
      .mockResolvedValueOnce({ ...chat, providerOverride: null });
    await renderWorkspace({ updateChat });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: new RegExp(chat.title) }));
    await user.click(screen.getByRole('button', { name: 'Edit provider override' }));
    const model = await screen.findByLabelText('Model');
    await user.clear(model);
    await user.type(model, 'override-model');
    await user.click(screen.getByRole('button', { name: 'Save provider' }));
    await waitFor(() =>
      expect(updateChat).toHaveBeenNthCalledWith(1, chat.id, {
        providerOverride: { source: 'nanogpt', model: 'override-model' },
      }),
    );

    await user.click(await screen.findByRole('button', { name: 'Use notebook default' }));
    await waitFor(() =>
      expect(updateChat).toHaveBeenNthCalledWith(2, chat.id, { providerOverride: null }),
    );
  });

  it('renders persisted history in seq order with status badges', async () => {
    const interrupted: Message = {
      ...assistantMessage,
      id: '9a1de1a1-63a4-4b8c-9a3e-6d3f7a15c111',
      seq: 3,
      content: 'A partial answer',
      status: 'interrupted',
    };
    const errored: Message = {
      ...assistantMessage,
      id: 'b30cf1de-8a9e-4a53-8a3a-2f60a1c22222',
      seq: 1,
      content: 'A failed answer',
      status: 'error',
    };
    const later: Message = {
      ...userMessage,
      id: 'c41df2ef-9baf-4b64-9b4b-3a71b2d33333',
      seq: 2,
      content: 'Go on.',
    };
    await renderWorkspace({
      getChat: () => Promise.resolve(detailWith([interrupted, errored, later, userMessage])),
    });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: new RegExp(chat.title) }));
    const list = await screen.findByRole('list', { name: 'Messages' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining(userMessage.content),
      expect.stringContaining('A failed answer'),
      expect.stringContaining('Go on.'),
      expect.stringContaining('A partial answer'),
    ]);
    expect(within(items[1] as HTMLElement).getByText('Error')).toBeDefined();
    expect(within(items[3] as HTMLElement).getByText('Interrupted')).toBeDefined();
    expect(screen.queryByText('Messages and streaming arrive in Phase 9.')).toBeNull();
  });

  it('shows an inviting empty state for a chat without messages', async () => {
    await renderWorkspace();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: new RegExp(chat.title) }));
    expect(await screen.findByText(/Ask about your sources/)).toBeDefined();
    expect(screen.queryByText('Messages and streaming arrive in Phase 9.')).toBeNull();
  });

  it('accumulates deltas into an ephemeral bubble and swaps in the persisted reply', async () => {
    const stream = createScriptedStream();
    const getChat = vi
      .fn()
      .mockResolvedValueOnce(detailWith([]))
      .mockResolvedValue(detailWith([userMessage, assistantMessage]));
    await renderWorkspace({ getChat, streamMessage: stream.streamMessage });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: new RegExp(chat.title) }));
    await user.type(await screen.findByLabelText('Message'), userMessage.content);
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() =>
      expect(stream.calls).toEqual([{ chatId: chat.id, content: userMessage.content }]),
    );
    expect(await screen.findByText(userMessage.content)).toBeDefined();
    const send = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);

    act(() => stream.emit({ type: 'delta', text: 'The coast ' }));
    act(() => stream.emit({ type: 'delta', text: 'is brass.' }));
    expect(await screen.findByText('The coast is brass.')).toBeDefined();

    act(() => stream.emit({ type: 'done', message: assistantMessage }));
    await waitFor(() => expect(getChat).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('The coast is brass.')).toBeDefined();
    expect(screen.getAllByText('The coast is brass.')).toHaveLength(1);
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
  });

  it('does not alter an in-flight stream while saving temperature', async () => {
    const stream = createScriptedStream();
    const returned = {
      ...defaultPreset,
      generation: { ...defaultPreset.generation, temperature: 1.25 },
    };
    const updatePreset = vi.fn().mockResolvedValue(returned);
    await renderWorkspace({ streamMessage: stream.streamMessage, updatePreset });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: new RegExp(chat.title) }));
    await user.type(await screen.findByLabelText('Message'), 'Keep charting');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(stream.calls).toHaveLength(1));

    fireEvent.change(screen.getByLabelText('Temperature'), { target: { value: '1.25' } });
    await waitFor(() => expect(updatePreset).toHaveBeenCalledTimes(1));

    expect(screen.getByRole('button', { name: 'Stop' })).toBeDefined();
    act(() => stream.emit({ type: 'delta', text: 'Still streaming' }));
    expect(await screen.findByText('Still streaming')).toBeDefined();

    act(() => stream.emit({ type: 'done', message: assistantMessage }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull());
  });

  it('shows the safe message and persisted error state on a stream error event', async () => {
    const errored: Message = { ...assistantMessage, content: 'Partial text', status: 'error' };
    const stream = createScriptedStream();
    const getChat = vi
      .fn()
      .mockResolvedValueOnce(detailWith([]))
      .mockResolvedValue(detailWith([userMessage, errored]));
    await renderWorkspace({ getChat, streamMessage: stream.streamMessage });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: new RegExp(chat.title) }));
    await user.type(await screen.findByLabelText('Message'), 'Hi');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(stream.calls).toHaveLength(1));

    act(() =>
      stream.emit({
        type: 'error',
        code: 'provider_error',
        message: 'Provider generation failed',
        messageState: errored,
      }),
    );

    expect(await screen.findByText('Provider generation failed')).toBeDefined();
    expect(await screen.findByText('Error')).toBeDefined();
    expect(await screen.findByText('Partial text')).toBeDefined();
  });

  it('renders a 409 generation-in-progress rejection inline', async () => {
    const streamMessage = vi
      .fn()
      .mockRejectedValue(
        new ApiClientError(409, 'generation_in_progress', 'Generation only runs one at a time.'),
      );
    await renderWorkspace({ streamMessage });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: new RegExp(chat.title) }));
    await user.type(await screen.findByLabelText('Message'), 'Hi');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('Generation only runs one at a time.')).toBeDefined();
    // The server never accepted the message, so the draft is given back.
    await waitFor(() =>
      expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toBe('Hi'),
    );
  });

  it('does not clobber another chat detail with a stale stream refetch', async () => {
    const chatB: Chat = {
      ...chat,
      id: '71b1c01d-142e-4a8d-8b2b-3f79552a47b7',
      title: 'Second chat',
    };
    const messageB: Message = {
      ...assistantMessage,
      id: '4aee8b4f-7e5f-4b67-b3b5-9c9b3aa7e1d0',
      chatId: chatB.id,
      content: 'B history',
    };
    const stream = createScriptedStream();
    const getChat = vi.fn((id: string) =>
      Promise.resolve(id === chatB.id ? { ...chatB, messages: [messageB] } : detailWith([])),
    );
    await renderWorkspace({
      listChats: () => Promise.resolve([chat, chatB]),
      getChat,
      streamMessage: stream.streamMessage,
    });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: new RegExp(chat.title) }));
    await user.type(await screen.findByLabelText('Message'), 'Hi');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(stream.calls).toHaveLength(1));

    // Switching chats aborts the stream; its cleanup must not refetch chat A
    // over chat B's freshly loaded detail.
    await user.click(screen.getByRole('button', { name: new RegExp(chatB.title) }));

    expect(await screen.findByText('B history')).toBeDefined();
    await waitFor(() =>
      expect(getChat.mock.calls.filter(([id]) => id === chat.id)).toHaveLength(1),
    );
    expect(screen.queryByText('Loading messages…')).toBeNull();
  });

  it('holds Send while a source-selection save is in flight', async () => {
    const sourceA: SourceMetadata = {
      id: '7d55ac1e-3f0a-4b8e-8a4e-1d2f3a4b5c60',
      notebookId: notebook.id,
      title: 'Field notes',
      slug: 'field-notes',
      filePath: 'notebooks/x/sources/field-notes.md',
      origin: { type: 'paste' },
      conversionNotes: [],
      wordCount: 7,
      contentHash: 'a'.repeat(64),
      createdAt: '2026-07-10T12:00:00.000Z',
      updatedAt: '2026-07-10T12:00:00.000Z',
    };
    let resolveUpdate: (value: Chat) => void = () => undefined;
    const updateChat = vi.fn(
      () =>
        new Promise<Chat>((resolve) => {
          resolveUpdate = resolve;
        }),
    );
    await renderWorkspace({
      listSources: () => Promise.resolve([sourceA]),
      getChat: () => Promise.resolve(detailWith([])),
      updateChat,
    });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: new RegExp(chat.title) }));
    await user.click(await screen.findByRole('checkbox', { name: 'Field notes' }));

    const send = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);

    act(() => resolveUpdate({ ...chat, sourceIds: [sourceA.id] }));
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
  });

  it('stops a stream and reconstructs the persisted interrupted message', async () => {
    const interrupted: Message = { ...assistantMessage, content: 'tick 0', status: 'interrupted' };
    const stream = createScriptedStream();
    const getChat = vi
      .fn()
      .mockResolvedValueOnce(detailWith([]))
      .mockResolvedValue(detailWith([userMessage, interrupted]));
    await renderWorkspace({ getChat, streamMessage: stream.streamMessage });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: new RegExp(chat.title) }));
    await user.type(await screen.findByLabelText('Message'), 'Hi');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(stream.calls).toHaveLength(1));
    act(() => stream.emit({ type: 'delta', text: 'tick 0' }));

    await user.click(screen.getByRole('button', { name: 'Stop' }));

    await waitFor(() => expect(getChat).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Interrupted')).toBeDefined();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('falls back to a refetch when the stream drops mid-flight', async () => {
    const interrupted: Message = { ...assistantMessage, content: 'tick 0', status: 'interrupted' };
    const stream = createScriptedStream();
    const getChat = vi
      .fn()
      .mockResolvedValueOnce(detailWith([]))
      .mockResolvedValue(detailWith([userMessage, interrupted]));
    await renderWorkspace({ getChat, streamMessage: stream.streamMessage });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: new RegExp(chat.title) }));
    await user.type(await screen.findByLabelText('Message'), 'Hi');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(stream.calls).toHaveLength(1));

    act(() => stream.fail(new ApiClientError(0, 'network_error', 'Could not reach the server.')));

    expect(await screen.findByText('Could not reach the server.')).toBeDefined();
    await waitFor(() => expect(getChat).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Interrupted')).toBeDefined();
  });

  it('persists source selection as a complete replacement', async () => {
    const sourceA: SourceMetadata = {
      id: '7d55ac1e-3f0a-4b8e-8a4e-1d2f3a4b5c60',
      notebookId: notebook.id,
      title: 'Field notes',
      slug: 'field-notes',
      filePath: 'notebooks/x/sources/field-notes.md',
      origin: { type: 'paste' },
      conversionNotes: [],
      wordCount: 7,
      contentHash: 'a'.repeat(64),
      createdAt: '2026-07-10T12:00:00.000Z',
      updatedAt: '2026-07-10T12:00:00.000Z',
    };
    const sourceB: SourceMetadata = {
      ...sourceA,
      id: '8e66bd2f-4a1b-4c9f-9b5f-2e3a4b5c6d71',
      title: 'Tide charts',
      slug: 'tide-charts',
    };
    const updateChat = vi
      .fn()
      .mockResolvedValueOnce({ ...chat, sourceIds: [sourceB.id] })
      .mockResolvedValueOnce({ ...chat, sourceIds: [sourceA.id, sourceB.id] });
    await renderWorkspace({
      listSources: () => Promise.resolve([sourceA, sourceB]),
      getChat: () => Promise.resolve(detailWith([], [sourceA.id, sourceB.id])),
      updateChat,
    });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: new RegExp(chat.title) }));
    expect(await screen.findByText('2 of 2 sources selected')).toBeDefined();

    await user.click(await screen.findByRole('checkbox', { name: 'Field notes' }));
    await waitFor(() =>
      expect(updateChat).toHaveBeenNthCalledWith(1, chat.id, { sourceIds: [sourceB.id] }),
    );
    expect(await screen.findByText('1 of 2 sources selected')).toBeDefined();

    await user.click(screen.getByRole('checkbox', { name: 'Field notes' }));
    await waitFor(() =>
      expect(updateChat).toHaveBeenNthCalledWith(2, chat.id, {
        sourceIds: [sourceA.id, sourceB.id],
      }),
    );
    expect(await screen.findByText('2 of 2 sources selected')).toBeDefined();
  });

  it('opens the inspector from stored context without using current source data', async () => {
    const sourceId = '7d55ac1e-3f0a-4b8e-8a4e-1d2f3a4b5c60';
    const currentSource: SourceMetadata = {
      id: sourceId,
      notebookId: notebook.id,
      title: 'Currently renamed source',
      slug: 'currently-renamed-source',
      filePath: 'notebooks/current.md',
      origin: { type: 'paste' },
      conversionNotes: [],
      wordCount: 2,
      contentHash: 'b'.repeat(64),
      createdAt: '2026-07-10T12:00:00.000Z',
      updatedAt: '2026-07-10T13:00:00.000Z',
    };
    const captured: Message = {
      ...assistantMessage,
      context: {
        contextVersion: 2,
        preset: defaultPreset,
        canonicalMessages: [{ role: 'user', content: 'Captured question' }],
        sources: [
          {
            id: sourceId,
            title: 'Deleted historical source',
            contentHash: 'a'.repeat(64),
            content: 'Exact historical content',
          },
        ],
        requestedControls: defaultPreset.generation,
        effectiveRequestBody: { model: 'nano-story', temperature: 0.7 },
        provider: 'nanogpt',
        model: 'nano-story',
      },
    };
    await renderWorkspace({
      listSources: () => Promise.resolve([currentSource]),
      getChat: () => Promise.resolve(detailWith([captured], [sourceId])),
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: new RegExp(chat.title) }));
    await user.click(await screen.findByRole('button', { name: 'Inspect prompt' }));

    const dialog = await screen.findByRole('dialog', { name: 'What the model received' });
    expect(within(dialog).getByText('Deleted historical source')).toBeDefined();
    expect(within(dialog).getByText('Exact historical content')).toBeDefined();
    expect(within(dialog).queryByText('Currently renamed source')).toBeNull();
  });

  it('allows the same assistant response to be saved repeatedly', async () => {
    const source: SourceMetadata = {
      id: '7d55ac1e-3f0a-4b8e-8a4e-1d2f3a4b5c60',
      notebookId: notebook.id,
      title: 'The coast is brass.',
      slug: 'the-coast-is-brass',
      filePath: 'notebooks/response.md',
      origin: {
        type: 'assistant-response',
        chatId: chat.id,
        messageId: assistantMessage.id,
      },
      conversionNotes: [],
      wordCount: 4,
      contentHash: 'a'.repeat(64),
      createdAt: '2026-07-10T12:02:00.000Z',
      updatedAt: '2026-07-10T12:02:00.000Z',
    };
    const second = { ...source, id: '8e66bd2f-4a1b-4c9f-9b5f-2e3a4b5c6d71' };
    const createSource = vi.fn().mockResolvedValueOnce(source).mockResolvedValueOnce(second);
    await renderWorkspace({
      getChat: () => Promise.resolve(detailWith([assistantMessage])),
      createSource,
      getSource: (id: string) =>
        Promise.resolve({
          ...(id === source.id ? source : second),
          content: assistantMessage.content,
        }),
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: new RegExp(chat.title) }));

    await user.click(await screen.findByRole('button', { name: 'Add to sources' }));
    await user.click(screen.getByRole('button', { name: 'Save source' }));
    await waitFor(() => expect(createSource).toHaveBeenCalledTimes(1));
    await screen.findByRole('heading', { name: source.title });

    await user.click(screen.getByRole('button', { name: 'Chat' }));
    await user.click(await screen.findByRole('button', { name: 'Add to sources' }));
    await user.click(screen.getByRole('button', { name: 'Save source' }));
    await waitFor(() => expect(createSource).toHaveBeenCalledTimes(2));
    expect(createSource.mock.calls[0]?.[1]).toEqual(createSource.mock.calls[1]?.[1]);
  });

  it('retries an explicit chat-list failure', async () => {
    const listChats = vi
      .fn()
      .mockRejectedValueOnce(new ApiClientError(500, 'internal_error', 'Failed'))
      .mockResolvedValueOnce([]);
    await renderWorkspace({ listChats });
    const user = userEvent.setup();

    expect(await screen.findByRole('heading', { name: 'Could not load chats' })).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No chats yet.')).toBeDefined();
    expect(listChats).toHaveBeenCalledTimes(2);
  });
});
