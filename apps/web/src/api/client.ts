import {
  agentChangesetDetailSchema,
  agentChangesetResolutionSchema,
  agentChatDetailSchema,
  agentChatSchema,
  apiErrorSchema,
  appSettingsSchema,
  bookCheckResultSchema,
  bookFileDetailSchema,
  bookFileSchema,
  bookSearchResultSchema,
  bookSummarySchema,
  bookTreeSchema,
  checkpointDetailSchema,
  checkpointSchema,
  connectionTestResponseSchema,
  createSecretSchema,
  customAgentSchema,
  manuscriptImportResultSchema,
  maskedSecretSchema,
  modelListResponseSchema,
  notebookMigrationReportSchema,
  providerCatalogEntrySchema,
  secretStateSchema,
  skillDetailSchema,
  skillMetadataListSchema,
  skillMetadataSchema,
  storyCommandOutcomeSchema,
  storySkillsInstallResultSchema,
  type AddEntityInput,
  type AgentChangesetDetail,
  type AgentChangesetResolution,
  type AgentChat,
  type AgentChatDetail,
  type AgentStreamEvent,
  type ApiErrorIssue,
  type AppSettings,
  type BookCheckCommand,
  type BookCheckResult,
  type BookEntityKind,
  type BookFile,
  type BookFileDetail,
  type BookSearchResult,
  type BookSummary,
  type BookTree,
  type Checkpoint,
  type CheckpointDetail,
  type ConnectionTestResponse,
  type CreateAgentChatInput,
  type CreateBookInput,
  type CreateCustomAgentInput,
  type CreateSkillInput,
  type CustomAgent,
  type ManuscriptImportResult,
  type MaskedSecret,
  type ModelListResponse,
  type NotebookMigrationReport,
  type PatchAgentChatInput,
  type PatchAppSettings,
  type PatchCustomAgentInput,
  type PatchSkill,
  type ProviderCatalogEntry,
  type ProviderConfig,
  type ProviderConnection,
  type RenameEntityInput,
  type SecretState,
  type SkillDetail,
  type SkillMetadata,
  type StoryCommandOutcome,
  type StorySkillsInstallResult,
  type WriteBookFileInput,
} from '@worldbookllm/shared';
import { z } from 'zod';

import { streamAgentMessage } from './stream.js';

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
  listBooks(signal?: AbortSignal): Promise<BookSummary[]>;
  createBook(input: CreateBookInput, signal?: AbortSignal): Promise<BookSummary>;
  importManuscript(file: File, signal?: AbortSignal): Promise<ManuscriptImportResult>;
  trashBook(slug: string, signal?: AbortSignal): Promise<void>;
  getBookTree(slug: string, signal?: AbortSignal): Promise<BookTree>;
  readBookFile(slug: string, path: string, signal?: AbortSignal): Promise<BookFileDetail>;
  writeBookFile(
    slug: string,
    path: string,
    input: WriteBookFileInput,
    signal?: AbortSignal,
  ): Promise<{ file: BookFile; checkpoint: Checkpoint | null }>;
  searchBook(slug: string, q: string, signal?: AbortSignal): Promise<BookSearchResult[]>;
  addBookEntity(
    slug: string,
    input: AddEntityInput,
    signal?: AbortSignal,
  ): Promise<StoryCommandOutcome>;
  renameBookEntity(
    slug: string,
    kind: BookEntityKind,
    id: string,
    input: RenameEntityInput,
    signal?: AbortSignal,
  ): Promise<StoryCommandOutcome>;
  removeBookEntity(
    slug: string,
    kind: BookEntityKind,
    id: string,
    signal?: AbortSignal,
  ): Promise<StoryCommandOutcome>;
  runBookCheck(
    slug: string,
    command: BookCheckCommand,
    signal?: AbortSignal,
  ): Promise<BookCheckResult>;
  listCheckpoints(slug: string, signal?: AbortSignal): Promise<Checkpoint[]>;
  getCheckpoint(slug: string, id: string, signal?: AbortSignal): Promise<CheckpointDetail>;
  undoCheckpoint(slug: string, id: string, signal?: AbortSignal): Promise<Checkpoint>;
  listAgentChats(slug: string, signal?: AbortSignal): Promise<AgentChat[]>;
  createAgentChat(
    slug: string,
    input?: CreateAgentChatInput,
    signal?: AbortSignal,
  ): Promise<AgentChat>;
  updateAgentChat(id: string, input: PatchAgentChatInput, signal?: AbortSignal): Promise<AgentChat>;
  getAgentChat(id: string, signal?: AbortSignal): Promise<AgentChatDetail>;
  getAgentChangeset(id: string, signal?: AbortSignal): Promise<AgentChangesetDetail>;
  resolveAgentChangeset(
    id: string,
    action: 'apply' | 'skip',
    paths?: string[],
    signal?: AbortSignal,
  ): Promise<AgentChangesetResolution>;
  listCustomAgents(signal?: AbortSignal): Promise<CustomAgent[]>;
  createCustomAgent(input: CreateCustomAgentInput, signal?: AbortSignal): Promise<CustomAgent>;
  updateCustomAgent(
    id: string,
    input: PatchCustomAgentInput,
    signal?: AbortSignal,
  ): Promise<CustomAgent>;
  deleteCustomAgent(id: string, signal?: AbortSignal): Promise<void>;
  deleteAgentChat(id: string, signal?: AbortSignal): Promise<void>;
  streamAgentMessage(
    chatId: string,
    content: string,
    options: StreamAgentMessageOptions,
  ): Promise<void>;
  installStorySkills(signal?: AbortSignal): Promise<StorySkillsInstallResult>;
  getProviderCatalog(signal?: AbortSignal): Promise<ProviderCatalogEntry[]>;
  listModels(connection: ProviderConnection, signal?: AbortSignal): Promise<ModelListResponse>;
  testConnection(config: ProviderConfig, signal?: AbortSignal): Promise<ConnectionTestResponse>;
  getSecrets(signal?: AbortSignal): Promise<SecretState>;
  createSecret(input: CreateSecretInput, signal?: AbortSignal): Promise<MaskedSecret>;
  activateSecret(key: string, id: string, signal?: AbortSignal): Promise<void>;
  deleteSecret(key: string, id: string, signal?: AbortSignal): Promise<void>;
  listSkills(signal?: AbortSignal): Promise<SkillMetadata[]>;
  createSkill(input: CreateSkillInput, signal?: AbortSignal): Promise<SkillMetadata>;
  getSkill(id: string, signal?: AbortSignal): Promise<SkillDetail>;
  updateSkill(id: string, input: PatchSkill, signal?: AbortSignal): Promise<SkillDetail>;
  deleteSkill(id: string, signal?: AbortSignal): Promise<void>;
  getAppSettings(signal?: AbortSignal): Promise<AppSettings>;
  updateAppSettings(input: PatchAppSettings, signal?: AbortSignal): Promise<AppSettings>;
  getNotebookMigration(signal?: AbortSignal): Promise<NotebookMigrationReport>;
  markNotebookMigrationSeen(signal?: AbortSignal): Promise<void>;
}

interface StreamAgentMessageOptions {
  onEvent: (event: AgentStreamEvent) => void;
  signal?: AbortSignal;
  /** Book files whose contents go to the model with this message. */
  pinnedPaths?: readonly string[];
}

type CreateSecretInput = z.input<typeof createSecretSchema>;

interface RequestOptions<T> {
  method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
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
  const bookListSchema = z.array(bookSummarySchema);
  const bookSearchResultListSchema = z.array(bookSearchResultSchema);
  const checkpointListSchema = z.array(checkpointSchema);
  const agentChatListSchema = z.array(agentChatSchema);
  const customAgentListSchema = z.array(customAgentSchema);
  const bookFileWriteSchema = z.object({
    file: bookFileSchema,
    checkpoint: checkpointSchema.nullable(),
  });
  const book = (slug: string) => `/api/books/${encodeURIComponent(slug)}`;
  // Book paths are nested; encode each segment and keep the slashes.
  const bookPath = (path: string) => path.split('/').map(encodeURIComponent).join('/');

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
    listBooks: (signal) => request('/api/books', { schema: bookListSchema, signal }),
    createBook: (input, signal) =>
      request('/api/books', { method: 'POST', body: input, schema: bookSummarySchema, signal }),
    importManuscript: (file, signal) => {
      const formData = new FormData();
      formData.append('file', file);
      return request('/api/books/import', {
        method: 'POST',
        formData,
        schema: manuscriptImportResultSchema,
        signal,
      });
    },
    trashBook: (slug, signal) => request(book(slug), { method: 'DELETE', signal }),
    getBookTree: (slug, signal) =>
      request(`${book(slug)}/tree`, { schema: bookTreeSchema, signal }),
    readBookFile: (slug, path, signal) =>
      request(`${book(slug)}/files/${bookPath(path)}`, { schema: bookFileDetailSchema, signal }),
    writeBookFile: (slug, path, input, signal) =>
      request(`${book(slug)}/files/${bookPath(path)}`, {
        method: 'PUT',
        body: input,
        schema: bookFileWriteSchema,
        signal,
      }),
    searchBook: (slug, q, signal) =>
      request(`${book(slug)}/search?${new URLSearchParams({ q }).toString()}`, {
        schema: bookSearchResultListSchema,
        signal,
      }),
    addBookEntity: (slug, input, signal) =>
      request(`${book(slug)}/entities`, {
        method: 'POST',
        body: input,
        schema: storyCommandOutcomeSchema,
        signal,
      }),
    renameBookEntity: (slug, kind, id, input, signal) =>
      request(`${book(slug)}/entities/${kind}/${encodeURIComponent(id)}/rename`, {
        method: 'POST',
        body: input,
        schema: storyCommandOutcomeSchema,
        signal,
      }),
    removeBookEntity: (slug, kind, id, signal) =>
      request(`${book(slug)}/entities/${kind}/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        schema: storyCommandOutcomeSchema,
        signal,
      }),
    runBookCheck: (slug, command, signal) =>
      request(`${book(slug)}/checks/${command}`, { schema: bookCheckResultSchema, signal }),
    listCheckpoints: (slug, signal) =>
      request(`${book(slug)}/checkpoints`, { schema: checkpointListSchema, signal }),
    getCheckpoint: (slug, id, signal) =>
      request(`${book(slug)}/checkpoints/${encodeURIComponent(id)}`, {
        schema: checkpointDetailSchema,
        signal,
      }),
    undoCheckpoint: (slug, id, signal) =>
      request(`${book(slug)}/checkpoints/${encodeURIComponent(id)}/undo`, {
        method: 'POST',
        schema: checkpointSchema,
        signal,
      }),
    listAgentChats: (slug, signal) =>
      request(`${book(slug)}/agent-chats`, { schema: agentChatListSchema, signal }),
    createAgentChat: (slug, input = {}, signal) =>
      request(`${book(slug)}/agent-chats`, {
        method: 'POST',
        body: input,
        schema: agentChatSchema,
        signal,
      }),
    updateAgentChat: (id, input, signal) =>
      request(`/api/agent-chats/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: input,
        schema: agentChatSchema,
        signal,
      }),
    getAgentChangeset: (id, signal) =>
      request(`/api/agent-changesets/${encodeURIComponent(id)}`, {
        schema: agentChangesetDetailSchema,
        signal,
      }),
    resolveAgentChangeset: (id, action, paths, signal) =>
      request(`/api/agent-changesets/${encodeURIComponent(id)}/${action}`, {
        method: 'POST',
        body: paths === undefined ? {} : { paths },
        schema: agentChangesetResolutionSchema,
        signal,
      }),
    listCustomAgents: (signal) => request('/api/agents', { schema: customAgentListSchema, signal }),
    createCustomAgent: (input, signal) =>
      request('/api/agents', { method: 'POST', body: input, schema: customAgentSchema, signal }),
    updateCustomAgent: (id, input, signal) =>
      request(`/api/agents/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: input,
        schema: customAgentSchema,
        signal,
      }),
    deleteCustomAgent: (id, signal) =>
      request(`/api/agents/${encodeURIComponent(id)}`, { method: 'DELETE', signal }),
    getAgentChat: (id, signal) =>
      request(`/api/agent-chats/${encodeURIComponent(id)}`, {
        schema: agentChatDetailSchema,
        signal,
      }),
    deleteAgentChat: (id, signal) =>
      request(`/api/agent-chats/${encodeURIComponent(id)}`, { method: 'DELETE', signal }),
    streamAgentMessage: (chatId, content, options) =>
      streamAgentMessage(chatId, content, { ...options, fetchImpl }),
    installStorySkills: (signal) =>
      request('/api/skills-story/install', {
        method: 'POST',
        schema: storySkillsInstallResultSchema,
        signal,
      }),
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
    listSkills: (signal) => request('/api/skills', { schema: skillMetadataListSchema, signal }),
    createSkill: (input, signal) =>
      request('/api/skills', {
        method: 'POST',
        body: input,
        schema: skillMetadataSchema,
        signal,
      }),
    getSkill: (id, signal) =>
      request(`/api/skills/${encodeURIComponent(id)}`, { schema: skillDetailSchema, signal }),
    updateSkill: (id, input, signal) =>
      request(`/api/skills/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: input,
        schema: skillDetailSchema,
        signal,
      }),
    deleteSkill: (id, signal) =>
      request(`/api/skills/${encodeURIComponent(id)}`, { method: 'DELETE', signal }),
    getAppSettings: (signal) => request('/api/app-settings', { schema: appSettingsSchema, signal }),
    updateAppSettings: (input, signal) =>
      request('/api/app-settings', {
        method: 'PATCH',
        body: input,
        schema: appSettingsSchema,
        signal,
      }),
    getNotebookMigration: (signal) =>
      request('/api/notebook-migration', { schema: notebookMigrationReportSchema, signal }),
    markNotebookMigrationSeen: (signal) =>
      request('/api/notebook-migration/seen', { method: 'POST', signal }),
  };
}
