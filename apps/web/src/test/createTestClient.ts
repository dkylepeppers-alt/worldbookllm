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
    getSource: unused,
    deleteSource: unused,
    ...overrides,
  };
}
