import {
  apiErrorSchema,
  chatDetailSchema,
  chatSchema,
  connectionTestResponseSchema,
  createChatSchema,
  createSecretSchema,
  maskedSecretSchema,
  modelListResponseSchema,
  notebookListSchema,
  notebookSchema,
  providerCatalogEntrySchema,
  secretStateSchema,
  sourceDetailSchema,
  sourceMetadataListSchema,
  sourceMetadataSchema,
  type ApiErrorIssue,
  type Chat,
  type ChatDetail,
  type ConnectionTestResponse,
  type CreateNotebookInput,
  type CreateSource,
  type MaskedSecret,
  type ModelListResponse,
  type Notebook,
  type PatchChat,
  type PatchNotebook,
  type ProviderCatalogEntry,
  type ProviderConfig,
  type ProviderConnection,
  type SecretState,
  type SourceDetail,
  type SourceMetadata,
} from '@worldbookllm/shared';
import { z } from 'zod';

interface ResponseSchema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly issues?: ApiErrorIssue[],
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export interface ApiClient {
  listNotebooks(signal?: AbortSignal): Promise<Notebook[]>;
  createNotebook(input: CreateNotebookInput, signal?: AbortSignal): Promise<Notebook>;
  getNotebook(id: string, signal?: AbortSignal): Promise<Notebook>;
  updateNotebook(id: string, input: PatchNotebook, signal?: AbortSignal): Promise<Notebook>;
  deleteNotebook(id: string, signal?: AbortSignal): Promise<void>;
  listSources(notebookId: string, signal?: AbortSignal): Promise<SourceMetadata[]>;
  createSource(
    notebookId: string,
    input: CreateSource,
    signal?: AbortSignal,
  ): Promise<SourceMetadata>;
  getSource(id: string, signal?: AbortSignal): Promise<SourceDetail>;
  deleteSource(id: string, signal?: AbortSignal): Promise<void>;
  getProviderCatalog(signal?: AbortSignal): Promise<ProviderCatalogEntry[]>;
  listModels(connection: ProviderConnection, signal?: AbortSignal): Promise<ModelListResponse>;
  testConnection(config: ProviderConfig, signal?: AbortSignal): Promise<ConnectionTestResponse>;
  getSecrets(signal?: AbortSignal): Promise<SecretState>;
  createSecret(input: CreateSecretInput, signal?: AbortSignal): Promise<MaskedSecret>;
  activateSecret(key: string, id: string, signal?: AbortSignal): Promise<void>;
  deleteSecret(key: string, id: string, signal?: AbortSignal): Promise<void>;
  listChats(notebookId: string, signal?: AbortSignal): Promise<Chat[]>;
  createChat(notebookId: string, input: CreateChatInput, signal?: AbortSignal): Promise<Chat>;
  getChat(id: string, signal?: AbortSignal): Promise<ChatDetail>;
  updateChat(id: string, input: PatchChat, signal?: AbortSignal): Promise<Chat>;
  deleteChat(id: string, signal?: AbortSignal): Promise<void>;
}

export type CreateSecretInput = z.input<typeof createSecretSchema>;
export type CreateChatInput = z.input<typeof createChatSchema>;

interface RequestOptions<T> {
  method?: 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  schema?: ResponseSchema<T>;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function createApiClient(fetchImpl: typeof fetch = globalThis.fetch): ApiClient {
  const providerCatalogSchema = z.array(providerCatalogEntrySchema);
  const chatListSchema = z.array(chatSchema);

  async function request<T>(path: string, options: RequestOptions<T> = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';

    let response: Response;
    try {
      response = await fetchImpl(path, {
        ...(options.method === undefined ? {} : { method: options.method }),
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: options.signal,
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new ApiClientError(0, 'network_error', 'Could not reach the server.');
    }

    if (!response.ok) {
      const body: unknown = await response.json().catch(() => undefined);
      const parsed = apiErrorSchema.safeParse(body);
      if (parsed.success) {
        throw new ApiClientError(
          response.status,
          parsed.data.error,
          parsed.data.message,
          parsed.data.issues,
        );
      }
      throw new ApiClientError(
        response.status,
        'http_error',
        response.statusText || `Request failed with status ${response.status}.`,
      );
    }

    if (response.status === 204) return undefined as T;

    const body: unknown = await response.json().catch(() => undefined);
    const parsed = options.schema?.safeParse(body);
    if (parsed?.success) return parsed.data;

    throw new ApiClientError(
      response.status,
      'invalid_response',
      'The server returned an invalid response.',
    );
  }

  return {
    listNotebooks: (signal) => request('/api/notebooks', { schema: notebookListSchema, signal }),
    createNotebook: (input, signal) =>
      request('/api/notebooks', { method: 'POST', body: input, schema: notebookSchema, signal }),
    getNotebook: (id, signal) =>
      request(`/api/notebooks/${encodeURIComponent(id)}`, { schema: notebookSchema, signal }),
    updateNotebook: (id, input, signal) =>
      request(`/api/notebooks/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: input,
        schema: notebookSchema,
        signal,
      }),
    deleteNotebook: (id, signal) =>
      request(`/api/notebooks/${encodeURIComponent(id)}`, { method: 'DELETE', signal }),
    listSources: (notebookId, signal) =>
      request(`/api/notebooks/${encodeURIComponent(notebookId)}/sources`, {
        schema: sourceMetadataListSchema,
        signal,
      }),
    createSource: (notebookId, input, signal) =>
      request(`/api/notebooks/${encodeURIComponent(notebookId)}/sources`, {
        method: 'POST',
        body: input,
        schema: sourceMetadataSchema,
        signal,
      }),
    getSource: (id, signal) =>
      request(`/api/sources/${encodeURIComponent(id)}`, { schema: sourceDetailSchema, signal }),
    deleteSource: (id, signal) =>
      request(`/api/sources/${encodeURIComponent(id)}`, { method: 'DELETE', signal }),
    getProviderCatalog: (signal) =>
      request('/api/providers', { schema: providerCatalogSchema, signal }),
    listModels: (connection, signal) =>
      request('/api/providers/models', {
        method: 'POST',
        body: connection,
        schema: modelListResponseSchema,
        signal,
      }),
    testConnection: (config, signal) =>
      request('/api/providers/test', {
        method: 'POST',
        body: config,
        schema: connectionTestResponseSchema,
        signal,
      }),
    getSecrets: (signal) => request('/api/secrets', { schema: secretStateSchema, signal }),
    createSecret: (input, signal) =>
      request('/api/secrets', {
        method: 'POST',
        body: input,
        schema: maskedSecretSchema,
        signal,
      }),
    activateSecret: (key, id, signal) =>
      request(
        `/api/secrets/${encodeURIComponent(key)}/${encodeURIComponent(id)}/activate`,
        { method: 'POST', signal },
      ),
    deleteSecret: (key, id, signal) =>
      request(`/api/secrets/${encodeURIComponent(key)}/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        signal,
      }),
    listChats: (notebookId, signal) =>
      request(`/api/notebooks/${encodeURIComponent(notebookId)}/chats`, {
        schema: chatListSchema,
        signal,
      }),
    createChat: (notebookId, input, signal) =>
      request(`/api/notebooks/${encodeURIComponent(notebookId)}/chats`, {
        method: 'POST',
        body: input,
        schema: chatSchema,
        signal,
      }),
    getChat: (id, signal) =>
      request(`/api/chats/${encodeURIComponent(id)}`, { schema: chatDetailSchema, signal }),
    updateChat: (id, input, signal) =>
      request(`/api/chats/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: input,
        schema: chatSchema,
        signal,
      }),
    deleteChat: (id, signal) =>
      request(`/api/chats/${encodeURIComponent(id)}`, { method: 'DELETE', signal }),
  };
}
