import {
  apiErrorSchema,
  appSettingsSchema,
  chatDetailSchema,
  chatSchema,
  connectionTestResponseSchema,
  createChatSchema,
  createSecretSchema,
  maskedSecretSchema,
  modelListResponseSchema,
  notebookListSchema,
  notebookSchema,
  presetListSchema,
  presetSchema,
  providerCatalogEntrySchema,
  secretStateSchema,
  messageSchema,
  sourceDetailSchema,
  sourceMetadataListSchema,
  sourceMetadataSchema,
  sourcePreviewSchema,
  type ApiErrorIssue,
  type AppSettings,
  type Chat,
  type ChatDetail,
  type ConnectionTestResponse,
  type CreateNotebookInput,
  type CreatePreset,
  type CreateSourceInput,
  type CreateSourcesInput,
  type MaskedSecret,
  type Message,
  type ModelListResponse,
  type Notebook,
  type PatchChat,
  type PatchNotebook,
  type PatchPreset,
  type PatchSource,
  type ProviderCatalogEntry,
  type ProviderConfig,
  type ProviderConnection,
  type Preset,
  type SecretState,
  type SourceDetail,
  type SourceMetadata,
  type SourcePreview,
  type StreamEvent,
} from '@worldbookllm/shared';
import { z } from 'zod';

import { streamChatMessage, streamRegenerate } from './stream.js';

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
    input: CreateSourceInput,
    signal?: AbortSignal,
  ): Promise<SourceMetadata>;
  createSources(
    notebookId: string,
    input: CreateSourcesInput,
    signal?: AbortSignal,
  ): Promise<SourceMetadata[]>;
  previewFileImport(notebookId: string, file: File, signal?: AbortSignal): Promise<SourcePreview>;
  getSource(id: string, signal?: AbortSignal): Promise<SourceDetail>;
  updateSource(id: string, input: PatchSource, signal?: AbortSignal): Promise<SourceDetail>;
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
  regenerateMessage(chatId: string, options: StreamMessageOptions): Promise<void>;
  selectVariant(messageId: string, activeVariant: number, signal?: AbortSignal): Promise<Message>;
  listPresets(signal?: AbortSignal): Promise<Preset[]>;
  createPreset(input: CreatePreset, signal?: AbortSignal): Promise<Preset>;
  getPreset(id: string, signal?: AbortSignal): Promise<Preset>;
  updatePreset(id: string, input: PatchPreset, signal?: AbortSignal): Promise<Preset>;
  deletePreset(id: string, signal?: AbortSignal): Promise<void>;
  getAppSettings(signal?: AbortSignal): Promise<AppSettings>;
  updateAppSettings(input: AppSettings, signal?: AbortSignal): Promise<AppSettings>;
  streamMessage(chatId: string, content: string, options: StreamMessageOptions): Promise<void>;
}

export interface StreamMessageOptions {
  onEvent: (event: StreamEvent) => void;
  signal?: AbortSignal;
}

export type CreateSecretInput = z.input<typeof createSecretSchema>;
export type CreateChatInput = z.input<typeof createChatSchema>;

interface RequestOptions<T> {
  method?: 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  formData?: FormData;
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
        ...(options.formData !== undefined
          ? { body: options.formData }
          : options.body === undefined
            ? {}
            : { body: JSON.stringify(options.body) }),
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
    createSources: (notebookId, input, signal) =>
      request(`/api/notebooks/${encodeURIComponent(notebookId)}/sources/batch`, {
        method: 'POST',
        body: input,
        schema: sourceMetadataListSchema,
        signal,
      }),
    previewFileImport: (notebookId, file, signal) => {
      const formData = new FormData();
      formData.append('file', file);
      return request(`/api/notebooks/${encodeURIComponent(notebookId)}/source-previews/file`, {
        method: 'POST',
        formData,
        schema: sourcePreviewSchema,
        signal,
      });
    },
    getSource: (id, signal) =>
      request(`/api/sources/${encodeURIComponent(id)}`, { schema: sourceDetailSchema, signal }),
    updateSource: (id, input, signal) =>
      request(`/api/sources/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: input,
        schema: sourceDetailSchema,
        signal,
      }),
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
      request(`/api/secrets/${encodeURIComponent(key)}/${encodeURIComponent(id)}/activate`, {
        method: 'POST',
        signal,
      }),
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
    regenerateMessage: (chatId, options) => streamRegenerate(chatId, { ...options, fetchImpl }),
    selectVariant: (messageId, activeVariant, signal) =>
      request(`/api/messages/${encodeURIComponent(messageId)}`, {
        method: 'PATCH',
        body: { activeVariant },
        schema: messageSchema,
        signal,
      }),
    listPresets: (signal) => request('/api/presets', { schema: presetListSchema, signal }),
    createPreset: (input, signal) =>
      request('/api/presets', {
        method: 'POST',
        body: input,
        schema: presetSchema,
        signal,
      }),
    getPreset: (id, signal) =>
      request(`/api/presets/${encodeURIComponent(id)}`, { schema: presetSchema, signal }),
    updatePreset: (id, input, signal) =>
      request(`/api/presets/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: input,
        schema: presetSchema,
        signal,
      }),
    deletePreset: (id, signal) =>
      request(`/api/presets/${encodeURIComponent(id)}`, { method: 'DELETE', signal }),
    getAppSettings: (signal) => request('/api/app-settings', { schema: appSettingsSchema, signal }),
    updateAppSettings: (input, signal) =>
      request('/api/app-settings', {
        method: 'PATCH',
        body: input,
        schema: appSettingsSchema,
        signal,
      }),
    streamMessage: (chatId, content, options) =>
      streamChatMessage(chatId, content, { ...options, fetchImpl }),
  };
}
