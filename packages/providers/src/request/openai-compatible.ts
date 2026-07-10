/**
 * OpenAI-compatible request building.
 *
 * Portions derived from SillyTavern (https://github.com/SillyTavern/SillyTavern),
 * AGPL-3.0, commit 29e0df488, src/endpoints/backends/chat-completions.js.
 * Not ported here: tools, JSON schema, logprobs, prompt caching, media, or
 * SillyTavern's reverse-proxy credential handling.
 */

import {
  addAssistantPrefix,
  postProcessPrompt,
  PROMPT_PROCESSING_TYPE,
} from '../convert/prompt-converters.js';
import { API_URLS, OPENROUTER_HEADERS, PROVIDER_META } from '../sources.js';
import {
  makePromptNames,
  ProviderError,
  type ChatCompletionSource,
  type ChatMessage,
  type GenerationParams,
  type ProviderChatRequest,
  type ReasoningEffort,
} from '../types.js';

export const OPENAI_COMPAT_SOURCES = [
  'openai',
  'openrouter',
  'custom',
  'perplexity',
  'groq',
  'nanogpt',
  'pollinations',
  'moonshot',
  'fireworks',
  'cometapi',
  'zai',
  'siliconflow',
  'workers_ai',
] as const;

export type OpenAiCompatibleSource = (typeof OPENAI_COMPAT_SOURCES)[number];

interface OpenAiCompatConfig {
  defaultBaseUrl?: string;
  headers?: Readonly<Record<string, string>>;
}

export const OPENAI_COMPAT_CONFIG: Record<OpenAiCompatibleSource, OpenAiCompatConfig> = {
  openai: { defaultBaseUrl: API_URLS.openai },
  openrouter: { defaultBaseUrl: API_URLS.openrouter, headers: OPENROUTER_HEADERS },
  custom: {},
  perplexity: { defaultBaseUrl: API_URLS.perplexity },
  groq: { defaultBaseUrl: API_URLS.groq },
  nanogpt: { defaultBaseUrl: API_URLS.nanogpt },
  pollinations: { defaultBaseUrl: API_URLS.pollinations },
  moonshot: { defaultBaseUrl: API_URLS.moonshot },
  fireworks: { defaultBaseUrl: API_URLS.fireworks },
  cometapi: { defaultBaseUrl: API_URLS.cometapi },
  zai: { defaultBaseUrl: API_URLS.zaiCommon, headers: { 'Accept-Language': 'en-US,en' } },
  siliconflow: { defaultBaseUrl: API_URLS.siliconflow },
  workers_ai: { defaultBaseUrl: API_URLS.workersAi },
};

const NANOGPT_REASONING_EFFORT: Partial<Record<ReasoningEffort, string>> = {
  min: 'none',
  low: 'minimal',
  medium: 'low',
  high: 'medium',
  max: 'high',
};

const OPENAI_REASONING_EFFORT_MODELS = new Set([
  'o1',
  'o3-mini',
  'o3-mini-2025-01-31',
  'o4-mini',
  'o4-mini-2025-04-16',
  'o3',
  'o3-2025-04-16',
  'gpt-5',
  'gpt-5-2025-08-07',
  'gpt-5-mini',
  'gpt-5-mini-2025-08-07',
  'gpt-5-nano',
  'gpt-5-nano-2025-08-07',
  'gpt-5.1',
  'gpt-5.1-2025-11-13',
  'gpt-5.1-chat-latest',
  'gpt-5.2',
  'gpt-5.2-2025-12-11',
  'gpt-5.2-chat-latest',
  'gpt-5.3-chat-latest',
  'gpt-5.4',
  'gpt-5.4-2026-03-05',
  'gpt-5.4-mini',
  'gpt-5.4-mini-2026-03-17',
  'gpt-5.4-nano',
  'gpt-5.4-nano-2026-03-17',
  'gpt-5.5',
  'gpt-5.5-2026-04-23',
]);

const OPENAI_REASONING_EFFORT: Partial<Record<ReasoningEffort, string>> = {
  min: 'minimal',
};

const OPENAI_FIXED_REASONING_EFFORT: Readonly<Record<string, string>> = {
  'gpt-5.3-chat-latest': 'medium',
};

export function getOpenAiReasoningEffort(
  model: string,
  effort: ReasoningEffort | undefined,
): string | undefined {
  if (!effort || effort === 'auto' || !OPENAI_REASONING_EFFORT_MODELS.has(model)) {
    return undefined;
  }
  return OPENAI_FIXED_REASONING_EFFORT[model] ?? OPENAI_REASONING_EFFORT[effort] ?? effort;
}

export function isOpenAiCompatibleSource(
  source: ChatCompletionSource,
): source is OpenAiCompatibleSource {
  return (OPENAI_COMPAT_SOURCES as readonly ChatCompletionSource[]).includes(source);
}

function definedEntries(object: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

function cloneMessages(messages: ChatMessage[]): ChatMessage[] {
  return structuredClone(messages);
}

function getExtraString(params: GenerationParams, key: string): string | undefined {
  const value = params.extra?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function getBaseUrl(source: OpenAiCompatibleSource, params: GenerationParams): string {
  if (params.baseUrl?.trim()) {
    return params.baseUrl.trim();
  }

  if (source === 'custom') {
    throw new ProviderError('Custom requires a base URL.', source);
  }

  if (source === 'pollinations' && !params.apiKey) {
    return API_URLS.pollinationsAnon;
  }

  if (source === 'zai' && getExtraString(params, 'endpoint') === 'coding') {
    return API_URLS.zaiCoding;
  }

  if (source === 'siliconflow' && getExtraString(params, 'region') === 'cn') {
    return API_URLS.siliconflowCn;
  }

  if (source === 'workers_ai') {
    const accountId = getExtraString(params, 'accountId');
    if (!accountId) {
      throw new ProviderError('Cloudflare Workers AI requires an account ID.', source);
    }
    return `${API_URLS.workersAi}/${encodeURIComponent(accountId)}/ai/v1`;
  }

  const baseUrl = OPENAI_COMPAT_CONFIG[source].defaultBaseUrl;
  if (!baseUrl) {
    throw new ProviderError(`${PROVIDER_META[source].label} requires a base URL.`, source);
  }
  return baseUrl;
}

function toChatCompletionsUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, '');
  return normalized.endsWith('/chat/completions') ? normalized : `${normalized}/chat/completions`;
}

function getMessages(source: OpenAiCompatibleSource, params: GenerationParams): ChatMessage[] {
  const messages = cloneMessages(params.messages);
  if (source === 'perplexity') {
    return postProcessPrompt(
      messages,
      PROMPT_PROCESSING_TYPE.STRICT,
      params.names ?? makePromptNames(),
    );
  }
  if (source === 'moonshot') {
    return addAssistantPrefix(messages, undefined, 'partial');
  }
  return messages;
}

function getProviderBody(
  source: OpenAiCompatibleSource,
  params: GenerationParams,
): Record<string, unknown> {
  const effort = params.reasoningEffort === 'auto' ? undefined : params.reasoningEffort;

  switch (source) {
    case 'openai':
    case 'custom': {
      if (!effort) {
        return {};
      }
      const reasoningEffort = getOpenAiReasoningEffort(params.model, effort);
      if (reasoningEffort) {
        return { reasoning_effort: reasoningEffort };
      }
      return source === 'custom' && /^koboldcpp\/(.+)$/.test(params.model)
        ? { reasoning_effort: effort }
        : {};
    }
    case 'openrouter':
      return {
        reasoning: definedEntries({
          exclude: !params.includeReasoning,
          effort,
        }),
      };
    case 'perplexity':
    case 'pollinations':
      return source === 'pollinations' && !params.apiKey
        ? {}
        : definedEntries({ reasoning_effort: effort });
    case 'nanogpt': {
      const mappedEffort = effort ? NANOGPT_REASONING_EFFORT[effort] : undefined;
      return mappedEffort ? { reasoning: { effort: mappedEffort } } : {};
    }
    case 'moonshot':
    case 'zai':
      return { thinking: { type: params.includeReasoning ? 'enabled' : 'disabled' } };
    case 'workers_ai':
      return definedEntries({ repetition_penalty: params.extra?.repetitionPenalty });
    case 'groq':
    case 'fireworks':
    case 'siliconflow':
    case 'cometapi':
      return {};
  }
}

export function assembleOpenAiCompatBody(
  source: OpenAiCompatibleSource,
  params: GenerationParams,
): Record<string, unknown> {
  return {
    ...definedEntries({
      messages: getMessages(source, params),
      model: params.model,
      temperature: params.temperature,
      max_tokens: params.maxTokens,
      stream: params.stream,
      presence_penalty: params.presencePenalty,
      frequency_penalty: params.frequencyPenalty,
      top_p: params.topP,
      top_k: params.topK,
      stop: params.stop?.length ? params.stop : undefined,
      seed: params.seed,
    }),
    ...getProviderBody(source, params),
  };
}

export function buildOpenAiCompatibleRequest(
  source: OpenAiCompatibleSource,
  params: GenerationParams,
): ProviderChatRequest {
  if (source === 'cometapi') {
    throw new ProviderError('CometAPI is temporarily disabled.', source);
  }

  if (!params.apiKey && !PROVIDER_META[source].keyOptional) {
    throw new ProviderError(`${PROVIDER_META[source].label} requires an API key.`, source);
  }

  const apiKey = source === 'pollinations' && !params.apiKey ? 'anonymous' : params.apiKey;
  return {
    url: toChatCompletionsUrl(getBaseUrl(source, params)),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      ...OPENAI_COMPAT_CONFIG[source].headers,
    },
    body: assembleOpenAiCompatBody(source, params),
  };
}
