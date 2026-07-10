/**
 * Provider model-list request planning and response normalization.
 *
 * Portions derived from SillyTavern (https://github.com/SillyTavern/SillyTavern),
 * AGPL-3.0, commit 29e0df488,
 * src/endpoints/backends/chat-completions.js:1743 (/status).
 * The caller executes every request; this module performs no network I/O.
 */

import { API_URLS, OPENROUTER_HEADERS } from '../sources.js';
import {
  ProviderError,
  type ChatCompletionSource,
  type ModelInfo,
  type ModelListParams,
  type ModelListPlan,
  type ProviderHttpRequest,
} from '../types.js';
import { getStaticModels } from './static-models.js';

const AIMLAPI_HEADERS = {
  'HTTP-Referer': 'https://github.com/dkylepeppers-alt/worldbookllm',
  'X-Title': 'worldbookllm',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extraString(params: ModelListParams, key: string): string | undefined {
  const value = params.extra?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function requireKey(
  source: ChatCompletionSource,
  label: string,
  apiKey: string | undefined,
): string {
  if (!apiKey) {
    throw new ProviderError(`${label} requires an API key.`, source);
  }
  return apiKey;
}

function modelsUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, '');
  return normalized.endsWith('/models') ? normalized : `${normalized}/models`;
}

function getRequest(
  url: string,
  apiKey: string | undefined,
  headers: Record<string, string> = {},
): ProviderHttpRequest {
  return {
    url,
    method: 'GET',
    headers: { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), ...headers },
  };
}

function azurePlan(params: ModelListParams): ModelListPlan {
  const baseUrl = params.baseUrl?.trim();
  const deploymentName = extraString(params, 'deploymentName');
  const apiVersion = extraString(params, 'apiVersion');
  const apiKey = params.apiKey;
  if (!baseUrl || !deploymentName || !apiVersion || !apiKey) {
    throw new ProviderError(
      'Azure OpenAI requires a base URL, deployment name, API version, and API key.',
      'azure_openai',
    );
  }

  const models = new URL('/openai/models', baseUrl);
  models.searchParams.set('api-version', apiVersion);
  const chat = new URL(
    `/openai/deployments/${encodeURIComponent(deploymentName)}/chat/completions`,
    baseUrl,
  );
  chat.searchParams.set('api-version', apiVersion);
  return {
    requests: [
      {
        url: models.toString(),
        method: 'GET',
        headers: { Accept: 'application/json', 'api-key': apiKey },
      },
      {
        url: chat.toString(),
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'api-key': apiKey,
        },
        body: {
          messages: [{ role: 'user', content: 'Say word Hi' }],
          stream: false,
          max_completion_tokens: 5,
        },
      },
    ],
  };
}

export function buildModelListPlan(
  source: ChatCompletionSource,
  params: ModelListParams,
): ModelListPlan {
  const staticModels = getStaticModels(source);
  if (staticModels) {
    return { requests: [], staticModels };
  }

  if (source === 'cometapi') {
    throw new ProviderError('CometAPI is temporarily disabled.', source);
  }
  if (source === 'custom') {
    const baseUrl = params.baseUrl?.trim();
    if (!baseUrl) {
      throw new ProviderError('Custom requires a base URL.', source);
    }
    return { requests: [getRequest(modelsUrl(baseUrl), params.apiKey)] };
  }
  if (source === 'pollinations') {
    return {
      requests: [
        getRequest('https://gen.pollinations.ai/text/models', params.apiKey ?? 'anonymous'),
      ],
    };
  }
  if (source === 'makersuite') {
    const apiKey = requireKey(source, 'Google AI Studio (Gemini)', params.apiKey);
    const baseUrl = (params.baseUrl?.trim() || API_URLS.makersuite).replace(/\/+$/, '');
    return {
      requests: [{ url: `${baseUrl}/v1beta/models?key=${apiKey}`, method: 'GET', headers: {} }],
    };
  }
  if (source === 'azure_openai') {
    return azurePlan(params);
  }
  if (source === 'siliconflow') {
    const apiKey = requireKey(source, 'SiliconFlow', params.apiKey);
    const baseUrl =
      extraString(params, 'region') === 'cn' ? API_URLS.siliconflowCn : API_URLS.siliconflow;
    const url = new URL(modelsUrl(params.baseUrl?.trim() || baseUrl));
    url.searchParams.set('type', 'text');
    url.searchParams.set('sub_type', 'chat');
    return { requests: [getRequest(url.toString(), apiKey)] };
  }
  if (source === 'workers_ai') {
    const apiKey = requireKey(source, 'Cloudflare Workers AI', params.apiKey);
    const accountId = extraString(params, 'accountId');
    if (!accountId) {
      throw new ProviderError('Cloudflare Workers AI requires an account ID.', source);
    }
    const url = new URL(`${API_URLS.workersAi}/${encodeURIComponent(accountId)}/ai/models/search`);
    url.searchParams.set('task', 'Text Generation');
    url.searchParams.set('per_page', '1000');
    return { requests: [getRequest(url.toString(), apiKey)] };
  }

  const liveConfig: Partial<
    Record<
      ChatCompletionSource,
      { label: string; baseUrl: string; headers?: Record<string, string> }
    >
  > = {
    openai: { label: 'OpenAI', baseUrl: API_URLS.openai },
    openrouter: {
      label: 'OpenRouter',
      baseUrl: API_URLS.openrouter,
      headers: { ...OPENROUTER_HEADERS },
    },
    mistralai: { label: 'Mistral AI', baseUrl: API_URLS.mistralai },
    cohere: { label: 'Cohere', baseUrl: API_URLS.cohereV1 },
    chutes: { label: 'Chutes', baseUrl: API_URLS.chutes },
    electronhub: { label: 'Electron Hub', baseUrl: API_URLS.electronhub },
    nanogpt: { label: 'NanoGPT', baseUrl: API_URLS.nanogpt },
    deepseek: { label: 'DeepSeek', baseUrl: API_URLS.deepseek },
    xai: { label: 'xAI (Grok)', baseUrl: API_URLS.xai },
    aimlapi: { label: 'AI/ML API', baseUrl: API_URLS.aimlapi, headers: AIMLAPI_HEADERS },
    groq: { label: 'Groq', baseUrl: API_URLS.groq },
    moonshot: { label: 'Moonshot (Kimi)', baseUrl: API_URLS.moonshot },
    fireworks: { label: 'Fireworks AI', baseUrl: API_URLS.fireworks },
  };
  const config = liveConfig[source];
  if (config) {
    const apiKey = requireKey(source, config.label, params.apiKey);
    return {
      requests: [
        getRequest(modelsUrl(params.baseUrl?.trim() || config.baseUrl), apiKey, config.headers),
      ],
    };
  }

  throw new ProviderError('Unsupported chat completion source.');
}

function providerError(source: ChatCompletionSource, data: unknown): void {
  if (!isRecord(data)) {
    return;
  }
  if (
    !data.error &&
    typeof data.message === 'string' &&
    !Array.isArray(data.data) &&
    !Array.isArray(data.models) &&
    !Array.isArray(data.result)
  ) {
    throw new ProviderError(data.message, source);
  }
  if (!data.error) {
    return;
  }
  const error = data.error;
  const message = isRecord(error)
    ? typeof error.message === 'string'
      ? error.message
      : 'Provider returned an error.'
    : typeof error === 'string'
      ? error
      : typeof data.message === 'string'
        ? data.message
        : 'Provider returned an error.';
  throw new ProviderError(message, source);
}

function modelsFromRecords(
  values: unknown[],
  idFrom: (record: Record<string, unknown>) => unknown = (record) => record.id,
): ModelInfo[] {
  return values.flatMap((value) => {
    if (!isRecord(value)) {
      return [];
    }
    const id = idFrom(value);
    return typeof id === 'string' && id ? [{ ...value, id }] : [];
  });
}

export function parseModelListResponse(
  source: ChatCompletionSource,
  data: unknown,
  step = 0,
): ModelInfo[] {
  providerError(source, data);

  const staticModels = getStaticModels(source);
  if (staticModels) {
    return staticModels;
  }
  if (source === 'azure_openai' && step === 1 && isRecord(data)) {
    if (typeof data.model !== 'string' || !data.model) {
      throw new ProviderError(
        'Azure OpenAI deployment probe did not return a model ID.',
        'azure_openai',
      );
    }
    return [{ id: data.model }];
  }
  if (source === 'makersuite' && isRecord(data) && Array.isArray(data.models)) {
    return modelsFromRecords(
      data.models.filter(
        (model) =>
          isRecord(model) &&
          Array.isArray(model.supportedGenerationMethods) &&
          model.supportedGenerationMethods.includes('generateContent'),
      ),
      (model) => (typeof model.name === 'string' ? model.name.replace(/^models\//, '') : undefined),
    );
  }
  if (source === 'cohere' && isRecord(data) && Array.isArray(data.models)) {
    return modelsFromRecords(data.models, (model) => model.name);
  }
  if (source === 'pollinations' && Array.isArray(data)) {
    return modelsFromRecords(data, (model) => model.name);
  }
  if (source === 'workers_ai' && isRecord(data) && Array.isArray(data.result)) {
    return modelsFromRecords(data.result, (model) => model.name);
  }
  if (isRecord(data) && Array.isArray(data.data)) {
    const models = modelsFromRecords(data.data);
    if (source === 'chutes') {
      return models.map((model) => {
        if (!isRecord(model.pricing)) {
          return model;
        }
        const { prompt, completion } = model.pricing;
        return prompt !== undefined && completion !== undefined
          ? {
              ...model,
              pricing: { ...model.pricing, input: prompt, output: completion },
            }
          : model;
      });
    }
    return models;
  }

  throw new ProviderError('Provider model response did not contain a model list.', source);
}
