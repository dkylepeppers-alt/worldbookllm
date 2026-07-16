import type { StreamEvent } from '@worldbookllm/shared';

import type { ApiClient } from '../api/client.js';

const unused = () => Promise.reject(new Error('Unexpected API call'));

export function createTestClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    listNotebooks: () => Promise.resolve([]),
    createNotebook: unused,
    getNotebook: unused,
    updateNotebook: unused,
    deleteNotebook: unused,
    listSources: () => Promise.resolve([]),
    createSource: unused,
    createSources: unused,
    previewFileImport: unused,
    getSource: unused,
    updateSource: unused,
    deleteSource: unused,
    getProviderCatalog: () => Promise.resolve([]),
    listModels: unused,
    testConnection: unused,
    getSecrets: () => Promise.resolve({}),
    createSecret: unused,
    activateSecret: unused,
    deleteSecret: unused,
    listChats: () => Promise.resolve([]),
    createChat: unused,
    getChat: unused,
    updateChat: unused,
    deleteChat: unused,
    regenerateMessage: unused,
    selectVariant: unused,
    listSkills: () => Promise.resolve([]),
    createSkill: unused,
    getSkill: unused,
    updateSkill: unused,
    deleteSkill: unused,
    listStarterSkills: () => Promise.resolve([]),
    installStarterSkills: unused,
    listPresets: () => Promise.resolve([]),
    createPreset: unused,
    getPreset: unused,
    updatePreset: unused,
    deletePreset: unused,
    getAppSettings: () =>
      Promise.resolve({ defaultPresetId: '00000000-0000-4000-8000-000000000000' }),
    updateAppSettings: unused,
    streamMessage: unused,
    ...overrides,
  };
}

export interface ScriptedStream {
  streamMessage: ApiClient['streamMessage'];
  calls: { chatId: string; content: string }[];
  /** Delivers an event to the in-flight stream; terminal events resolve it. */
  emit(event: StreamEvent): void;
  /** Rejects the in-flight stream, e.g. with a network error. */
  fail(error: unknown): void;
}

/**
 * A scriptable stand-in for ApiClient.streamMessage: each call stays pending
 * until the test emits events (a `done`/`error` event resolves it, mirroring
 * the real client) or fails it; aborting the passed signal rejects with an
 * AbortError like a real aborted fetch.
 */
export function createScriptedStream(): ScriptedStream {
  let active: {
    onEvent: (event: StreamEvent) => void;
    resolve: () => void;
    reject: (error: unknown) => void;
  } | null = null;
  const calls: { chatId: string; content: string }[] = [];
  return {
    calls,
    streamMessage: (chatId, content, options) => {
      calls.push({ chatId, content });
      return new Promise<void>((resolve, reject) => {
        // Like real fetch: an already-aborted signal rejects immediately
        // instead of leaving the promise pending forever.
        if (options.signal?.aborted === true) {
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        options.signal?.addEventListener('abort', () => {
          active = null;
          reject(new DOMException('Aborted', 'AbortError'));
        });
        active = { onEvent: options.onEvent, resolve, reject };
      });
    },
    emit(event) {
      if (active === null) throw new Error('No stream in flight');
      active.onEvent(event);
      if (event.type !== 'delta') {
        active.resolve();
        active = null;
      }
    },
    fail(error) {
      if (active === null) throw new Error('No stream in flight');
      active.reject(error);
      active = null;
    },
  };
}
