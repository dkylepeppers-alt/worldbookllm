import { DEFAULT_AGENT_GENERATION, type AgentStreamEvent } from '@worldbookllm/shared';

import type { ApiClient } from '../api/client.js';

const unused = () => Promise.reject(new Error('Unexpected API call'));

export function createTestClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    listBookConflicts: async () => [],
    removeSeriesBook: unused,
    syncSeries: unused,
    getSeries: unused,
    getSeriesHealth: unused,
    listBooks: () => Promise.resolve([]),
    createBook: unused,
    createSeries: unused,
    addSeriesBook: unused,
    moveBookToSeries: unused,
    importManuscript: unused,
    trashBook: unused,
    getBookTree: unused,
    readBookFile: unused,
    writeBookFile: unused,
    searchBook: () => Promise.resolve([]),
    addBookEntity: unused,
    renameBookEntity: unused,
    removeBookEntity: unused,
    runBookCheck: unused,
    listCheckpoints: () => Promise.resolve([]),
    getCheckpoint: unused,
    undoCheckpoint: unused,
    listAgentChats: () => Promise.resolve([]),
    createAgentChat: unused,
    updateAgentChat: unused,
    getAgentChat: unused,
    getAgentChangeset: unused,
    resolveAgentChangeset: unused,
    listCustomAgents: () => Promise.resolve([]),
    createCustomAgent: unused,
    updateCustomAgent: unused,
    deleteCustomAgent: unused,
    deleteAgentChat: unused,
    stopAgentChat: unused,
    streamAgentMessage: unused,
    installStorySkills: unused,
    getProviderCatalog: () => Promise.resolve([]),
    listModels: unused,
    testConnection: unused,
    getSecrets: () => Promise.resolve({}),
    createSecret: unused,
    activateSecret: unused,
    deleteSecret: unused,
    listSkills: () => Promise.resolve([]),
    createSkill: unused,
    getSkill: unused,
    updateSkill: unused,
    deleteSkill: unused,
    getAppSettings: () =>
      Promise.resolve({
        providerConfig: null,
        agentReviewMode: false,
        agentGeneration: DEFAULT_AGENT_GENERATION,
      }),
    getNotebookMigration: () => Promise.resolve({ entries: [], archivePath: null, seen: true }),
    markNotebookMigrationSeen: () => Promise.resolve(),
    updateAppSettings: unused,
    ...overrides,
  };
}

export interface ScriptedAgentStream {
  streamAgentMessage: ApiClient['streamAgentMessage'];
  calls: { chatId: string; content: string }[];
  /** Delivers an event to the in-flight turn; `done`/`error` resolve it. */
  emit(event: AgentStreamEvent): void;
  /** Rejects the in-flight turn, e.g. with an HTTP error before the stream began. */
  fail(error: unknown): void;
  readonly active: boolean;
}

/** The agent-turn counterpart of createScriptedStream. */
export function createScriptedAgentStream(): ScriptedAgentStream {
  let active: {
    onEvent: (event: AgentStreamEvent) => void;
    resolve: () => void;
    reject: (error: unknown) => void;
  } | null = null;
  const calls: { chatId: string; content: string }[] = [];
  return {
    calls,
    get active() {
      return active !== null;
    },
    streamAgentMessage: (chatId, content, options) => {
      calls.push({ chatId, content });
      return new Promise<void>((resolve, reject) => {
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
      if (active === null) throw new Error('No agent turn in flight');
      active.onEvent(event);
      if (event.type === 'done' || event.type === 'error') {
        active.resolve();
        active = null;
      }
    },
    fail(error) {
      if (active === null) throw new Error('No agent turn in flight');
      active.reject(error);
      active = null;
    },
  };
}
