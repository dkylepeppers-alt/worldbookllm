import type {
  ConnectionTestResponse,
  ModelInfo,
  ProviderCatalogEntry,
  ProviderConfig,
  ProviderConnection,
  GenerationControls,
} from '@worldbookllm/shared';
import {
  buildChatRequest,
  buildModelListPlan,
  CHAT_COMPLETION_SOURCES,
  parseCompletionResponse,
  parseModelListResponse,
  PROVIDER_META,
  ProviderError,
  type ChatMessage,
  type ProviderChatRequest,
} from '@worldbookllm/providers';

import { ConfigurationError } from '../errors.js';
import type { ProviderHttpClient } from '../providers/http-client.js';
import type { SecretStore } from '../secrets/secret-store.js';

export class ProviderService {
  constructor(
    private readonly secrets: SecretStore,
    private readonly http: ProviderHttpClient,
  ) {}

  getCatalog(): ProviderCatalogEntry[] {
    return CHAT_COMPLETION_SOURCES.map((source) => {
      const meta = PROVIDER_META[source];
      return {
        source,
        label: meta.label,
        family: meta.family,
        secretKey: meta.secretKey,
        modelSource: meta.modelSource,
        ...(meta.needsBaseUrl !== undefined ? { needsBaseUrl: meta.needsBaseUrl } : {}),
        ...(meta.keyOptional !== undefined ? { keyOptional: meta.keyOptional } : {}),
        ...(meta.extraFields
          ? {
              extraFields: meta.extraFields.map((field) => ({
                key: field.key,
                label: field.label,
                required: field.required,
                ...(field.options ? { options: Array.from(field.options) } : {}),
              })),
            }
          : {}),
        hasSecret: this.secrets.readActive(meta.secretKey) !== '',
      };
    });
  }

  private apiKey(source: ProviderConfig['source']): string | undefined {
    return this.secrets.readActive(PROVIDER_META[source].secretKey) || undefined;
  }

  private requireApiKey(config: ProviderConfig): string | undefined {
    const key = this.apiKey(config.source);
    if (!key && !PROVIDER_META[config.source].keyOptional) {
      throw new ConfigurationError(`${PROVIDER_META[config.source].label} requires an API key.`);
    }
    return key;
  }

  async listModels(connection: ProviderConnection): Promise<ModelInfo[]> {
    const source = connection.source;
    let plan;
    try {
      plan = buildModelListPlan(source, {
        apiKey: this.apiKey(source),
        baseUrl: connection.baseUrl,
        extra: connection.extra,
      });
    } catch (error) {
      if (error instanceof ProviderError) throw new ConfigurationError(error.message);
      throw error;
    }
    if (plan.staticModels) return plan.staticModels.map((model) => ({ ...model }));
    let models: ModelInfo[] = [];
    for (const [step, request] of plan.requests.entries()) {
      const data = await this.http.fetchJson(source, request);
      models = parseModelListResponse(source, data, step);
    }
    return models;
  }

  async testConnection(config: ProviderConfig): Promise<ConnectionTestResponse> {
    const meta = PROVIDER_META[config.source];
    const apiKey = this.requireApiKey(config);
    if (meta.modelSource === 'live') {
      await this.listModels(config);
      return { ok: true, detail: 'Model endpoint reachable' };
    }

    let request: ProviderChatRequest;
    try {
      request = buildChatRequest(config.source, {
        model: config.model,
        messages: [{ role: 'user', content: 'Reply with OK' }],
        stream: false,
        apiKey,
        baseUrl: config.baseUrl,
        extra: config.extra,
        maxTokens: 4,
        temperature: 0,
      });
    } catch (error) {
      if (error instanceof ProviderError) throw new ConfigurationError(error.message);
      throw error;
    }
    const data = await this.http.fetchJson(config.source, request);
    parseCompletionResponse(config.source, data);
    return { ok: true, detail: 'Completion endpoint reachable' };
  }

  createChatRequest(
    config: ProviderConfig,
    messages: ChatMessage[],
    controls: GenerationControls,
  ): ProviderChatRequest {
    const apiKey = this.requireApiKey(config);
    try {
      return buildChatRequest(config.source, {
        model: config.model,
        messages,
        stream: true,
        apiKey,
        baseUrl: config.baseUrl,
        extra: config.extra,
        temperature: controls.temperature,
        topP: controls.topP ?? undefined,
        maxTokens: controls.maxTokens ?? undefined,
        assistantPrefill: controls.assistantPrefill ?? undefined,
        // The thinking toggle asks the provider to reason and to surface that
        // reasoning in the response. Effort 'auto' lets each provider pick a
        // sensible budget; some providers (e.g. Claude) only engage thinking
        // when maxTokens is also set.
        ...(controls.thinking === true
          ? { includeReasoning: true, reasoningEffort: 'auto' as const }
          : {}),
      });
    } catch (error) {
      if (error instanceof ProviderError) throw new ConfigurationError(error.message);
      throw error;
    }
  }

  snapshotRequestBody(request: ProviderChatRequest): Record<string, unknown> {
    const cloned = JSON.parse(JSON.stringify(request.body)) as Record<string, unknown>;
    const secrets = this.secrets
      .readActiveValues()
      .sort((left, right) => right.length - left.length);
    const redact = (value: unknown): unknown => {
      if (typeof value === 'string') {
        return secrets.reduce(
          (redacted, secret) => redacted.replaceAll(secret, '[redacted]'),
          value,
        );
      }
      if (Array.isArray(value)) return value.map(redact);
      if (value && typeof value === 'object') {
        return Object.fromEntries(
          Object.entries(value).map(([key, nested]) => [key, redact(nested)]),
        );
      }
      return value;
    };
    return redact(cloned) as Record<string, unknown>;
  }

  openChatStream(
    source: ProviderConfig['source'],
    request: ProviderChatRequest,
    signal: AbortSignal,
  ): Promise<ReadableStream<Uint8Array>> {
    return this.http.fetchStream(source, request, signal);
  }
}
