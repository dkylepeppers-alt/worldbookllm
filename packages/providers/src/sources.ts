/**
 * Chat-completion source catalog.
 *
 * Portions derived from SillyTavern (https://github.com/SillyTavern/SillyTavern),
 * AGPL-3.0, commit 29e0df488: CHAT_COMPLETION_SOURCES (src/constants.js:187),
 * SECRET_KEYS (src/endpoints/secrets.js:9), and the API_* base-URL constants
 * (src/endpoints/backends/chat-completions.js:70).
 */

import type { ChatCompletionSource } from './types.js';

export const CHAT_COMPLETION_SOURCES = [
  'openai',
  'claude',
  'openrouter',
  'ai21',
  'makersuite',
  'vertexai',
  'mistralai',
  'custom',
  'cohere',
  'perplexity',
  'groq',
  'chutes',
  'electronhub',
  'nanogpt',
  'deepseek',
  'aimlapi',
  'xai',
  'pollinations',
  'moonshot',
  'fireworks',
  'cometapi',
  'azure_openai',
  'zai',
  'siliconflow',
  'minimax',
  'workers_ai',
] as const satisfies readonly ChatCompletionSource[];

export function isChatCompletionSource(value: string): value is ChatCompletionSource {
  return (CHAT_COMPLETION_SOURCES as readonly string[]).includes(value);
}

/** Default API base URLs (chat-completions.js:70–98). */
export const API_URLS = {
  openai: 'https://api.openai.com/v1',
  claude: 'https://api.anthropic.com/v1',
  mistralai: 'https://api.mistral.ai/v1',
  cohereV1: 'https://api.cohere.ai/v1',
  cohereV2: 'https://api.cohere.ai/v2',
  perplexity: 'https://api.perplexity.ai',
  groq: 'https://api.groq.com/openai/v1',
  makersuite: 'https://generativelanguage.googleapis.com',
  vertexai: 'https://us-central1-aiplatform.googleapis.com',
  ai21: 'https://api.ai21.com/studio/v1',
  chutes: 'https://llm.chutes.ai/v1',
  electronhub: 'https://api.electronhub.ai/v1',
  nanogpt: 'https://nano-gpt.com/api/v1',
  deepseek: 'https://api.deepseek.com/beta',
  xai: 'https://api.x.ai/v1',
  aimlapi: 'https://api.aimlapi.com/v1',
  pollinations: 'https://gen.pollinations.ai/v1',
  pollinationsAnon: 'https://text.pollinations.ai/v1',
  moonshot: 'https://api.moonshot.ai/v1',
  fireworks: 'https://api.fireworks.ai/inference/v1',
  cometapi: 'https://api.cometapi.com/v1',
  zaiCommon: 'https://api.z.ai/api/paas/v4',
  zaiCoding: 'https://api.z.ai/api/coding/paas/v4',
  siliconflow: 'https://api.siliconflow.com/v1',
  siliconflowCn: 'https://api.siliconflow.cn/v1',
  minimax: 'https://api.minimax.io/v1',
  minimaxCn: 'https://api.minimaxi.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  workersAi: 'https://api.cloudflare.com/client/v4/accounts',
} as const;

/** Sent with every OpenRouter request (ST src/constants.js). */
export const OPENROUTER_HEADERS = {
  'HTTP-Referer': 'https://github.com/dkylepeppers-alt/worldbookllm',
  'X-Title': 'worldbookllm',
} as const;

/** An extra provider-specific config field, rendered generically by the UI. */
export interface ProviderExtraField {
  key: string;
  label: string;
  required: boolean;
  /** For enum-like fields: allowed values (first is the default). */
  options?: readonly string[];
}

export interface ProviderMeta {
  source: ChatCompletionSource;
  label: string;
  /** 'openai-compat' sources share one request-building path; 'dedicated' have their own. */
  family: 'openai-compat' | 'dedicated';
  /** Storage key in the secret store (ST-compatible names). */
  secretKey: string;
  /** True when the source cannot work without a user-supplied base URL. */
  needsBaseUrl?: boolean;
  /** True when a missing API key is acceptable (e.g. anonymous tiers, local servers). */
  keyOptional?: boolean;
  /** Where model lists come from: a live endpoint or a curated static list. */
  modelSource: 'live' | 'static';
  extraFields?: readonly ProviderExtraField[];
}

export const PROVIDER_META: Record<ChatCompletionSource, ProviderMeta> = {
  openai: {
    source: 'openai',
    label: 'OpenAI',
    family: 'openai-compat',
    secretKey: 'api_key_openai',
    modelSource: 'live',
  },
  claude: {
    source: 'claude',
    label: 'Anthropic Claude',
    family: 'dedicated',
    secretKey: 'api_key_claude',
    modelSource: 'static',
  },
  openrouter: {
    source: 'openrouter',
    label: 'OpenRouter',
    family: 'openai-compat',
    secretKey: 'api_key_openrouter',
    modelSource: 'live',
  },
  ai21: {
    source: 'ai21',
    label: 'AI21',
    family: 'dedicated',
    secretKey: 'api_key_ai21',
    modelSource: 'static',
  },
  makersuite: {
    source: 'makersuite',
    label: 'Google AI Studio (Gemini)',
    family: 'dedicated',
    secretKey: 'api_key_makersuite',
    modelSource: 'live',
  },
  vertexai: {
    source: 'vertexai',
    label: 'Google Vertex AI',
    family: 'dedicated',
    secretKey: 'api_key_vertexai',
    modelSource: 'static',
    extraFields: [{ key: 'region', label: 'Region', required: false }],
  },
  mistralai: {
    source: 'mistralai',
    label: 'Mistral AI',
    family: 'dedicated',
    secretKey: 'api_key_mistralai',
    modelSource: 'live',
  },
  custom: {
    source: 'custom',
    label: 'Custom (OpenAI-compatible)',
    family: 'openai-compat',
    secretKey: 'api_key_custom',
    needsBaseUrl: true,
    keyOptional: true,
    modelSource: 'live',
  },
  cohere: {
    source: 'cohere',
    label: 'Cohere',
    family: 'dedicated',
    secretKey: 'api_key_cohere',
    modelSource: 'live',
  },
  perplexity: {
    source: 'perplexity',
    label: 'Perplexity',
    family: 'openai-compat',
    secretKey: 'api_key_perplexity',
    modelSource: 'static',
  },
  groq: {
    source: 'groq',
    label: 'Groq',
    family: 'openai-compat',
    secretKey: 'api_key_groq',
    modelSource: 'live',
  },
  chutes: {
    source: 'chutes',
    label: 'Chutes',
    family: 'dedicated',
    secretKey: 'api_key_chutes',
    modelSource: 'live',
  },
  electronhub: {
    source: 'electronhub',
    label: 'Electron Hub',
    family: 'dedicated',
    secretKey: 'api_key_electronhub',
    modelSource: 'live',
  },
  nanogpt: {
    source: 'nanogpt',
    label: 'NanoGPT',
    family: 'openai-compat',
    secretKey: 'api_key_nanogpt',
    modelSource: 'live',
  },
  deepseek: {
    source: 'deepseek',
    label: 'DeepSeek',
    family: 'dedicated',
    secretKey: 'api_key_deepseek',
    modelSource: 'live',
  },
  aimlapi: {
    source: 'aimlapi',
    label: 'AI/ML API',
    family: 'dedicated',
    secretKey: 'api_key_aimlapi',
    modelSource: 'live',
  },
  xai: {
    source: 'xai',
    label: 'xAI (Grok)',
    family: 'dedicated',
    secretKey: 'api_key_xai',
    modelSource: 'live',
  },
  pollinations: {
    source: 'pollinations',
    label: 'Pollinations',
    family: 'openai-compat',
    secretKey: 'api_key_pollinations',
    keyOptional: true,
    modelSource: 'live',
  },
  moonshot: {
    source: 'moonshot',
    label: 'Moonshot (Kimi)',
    family: 'openai-compat',
    secretKey: 'api_key_moonshot',
    modelSource: 'live',
  },
  fireworks: {
    source: 'fireworks',
    label: 'Fireworks AI',
    family: 'openai-compat',
    secretKey: 'api_key_fireworks',
    modelSource: 'live',
  },
  cometapi: {
    source: 'cometapi',
    label: 'CometAPI',
    family: 'openai-compat',
    secretKey: 'api_key_cometapi',
    modelSource: 'live',
  },
  azure_openai: {
    source: 'azure_openai',
    label: 'Azure OpenAI',
    family: 'dedicated',
    secretKey: 'api_key_azure_openai',
    needsBaseUrl: true,
    modelSource: 'static',
    extraFields: [
      { key: 'deploymentName', label: 'Deployment name', required: true },
      { key: 'apiVersion', label: 'API version', required: true },
    ],
  },
  zai: {
    source: 'zai',
    label: 'Z.AI (GLM)',
    family: 'openai-compat',
    secretKey: 'api_key_zai',
    modelSource: 'static',
    extraFields: [
      { key: 'endpoint', label: 'Endpoint', required: false, options: ['common', 'coding'] },
    ],
  },
  siliconflow: {
    source: 'siliconflow',
    label: 'SiliconFlow',
    family: 'openai-compat',
    secretKey: 'api_key_siliconflow',
    modelSource: 'live',
    extraFields: [
      { key: 'region', label: 'Region', required: false, options: ['international', 'cn'] },
    ],
  },
  minimax: {
    source: 'minimax',
    label: 'MiniMax',
    family: 'dedicated',
    secretKey: 'api_key_minimax',
    modelSource: 'static',
    extraFields: [
      { key: 'region', label: 'Region', required: false, options: ['international', 'cn'] },
    ],
  },
  workers_ai: {
    source: 'workers_ai',
    label: 'Cloudflare Workers AI',
    family: 'openai-compat',
    secretKey: 'api_key_workers_ai',
    modelSource: 'live',
    extraFields: [{ key: 'accountId', label: 'Cloudflare account ID', required: true }],
  },
};
