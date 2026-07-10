/**
 * Core types for the provider layer.
 *
 * Message shapes are deliberately tolerant (string or part-array content,
 * optional tool fields) because the ported SillyTavern converters normalize
 * loosely-shaped inputs at runtime; over-constraining them here would change
 * behavior.
 */

export type ChatCompletionSource =
  | 'openai'
  | 'claude'
  | 'openrouter'
  | 'ai21'
  | 'makersuite'
  | 'vertexai'
  | 'mistralai'
  | 'custom'
  | 'cohere'
  | 'perplexity'
  | 'groq'
  | 'chutes'
  | 'electronhub'
  | 'nanogpt'
  | 'deepseek'
  | 'aimlapi'
  | 'xai'
  | 'pollinations'
  | 'moonshot'
  | 'fireworks'
  | 'cometapi'
  | 'azure_openai'
  | 'zai'
  | 'siliconflow'
  | 'minimax'
  | 'workers_ai';

export interface ToolCall {
  id: string;
  function: { name: string; arguments: string | Record<string, unknown> };
  signature?: string;
  [key: string]: unknown;
}

export interface ContentPart {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export interface ChatMessage {
  role: string;
  content: string | ContentPart[] | null;
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  signature?: string;
  prefix?: boolean;
  [key: string]: unknown;
}

/** Names used when flattening named/example messages into plain content. */
export interface PromptNames {
  charName: string;
  userName: string;
  groupNames: string[];
  startsWithGroupName(message: string): boolean;
}

export function makePromptNames(
  init: Partial<Pick<PromptNames, 'charName' | 'userName' | 'groupNames'>> = {},
): PromptNames {
  const groupNames = init.groupNames ?? [];
  return {
    charName: init.charName ?? '',
    userName: init.userName ?? '',
    groupNames,
    startsWithGroupName(message: string): boolean {
      return groupNames.some((name) => message.startsWith(`${name}: `));
    },
  };
}

export type ReasoningEffort = 'auto' | 'min' | 'low' | 'medium' | 'high' | 'max';

/** Everything needed to build one provider request. Keys are injected — the
 * package never reads secrets or config itself. */
export interface GenerationParams {
  model: string;
  messages: ChatMessage[];
  stream: boolean;
  apiKey?: string;
  /** Override the provider's default API base URL (custom endpoints, proxies). */
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stop?: string[];
  seed?: number;
  reasoningEffort?: ReasoningEffort;
  /** Request that reasoning/thinking text be included in responses where supported. */
  includeReasoning?: boolean;
  /** Assistant prefill text (Claude-style), where supported. */
  assistantPrefill?: string;
  /** Character/user names for message-name flattening. */
  names?: PromptNames;
  /** Provider-specific extras (azure deployment, workers_ai account id, zai endpoint, …). */
  extra?: Record<string, unknown>;
}

/** A fully-built provider HTTP request; the caller performs the fetch. */
export interface ProviderChatRequest {
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** HTTP request description for provider operations performed by a caller. */
export interface ProviderHttpRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: Record<string, unknown> | string;
}

/** Injected connection details used to discover provider models. */
export interface ModelListParams {
  apiKey?: string;
  baseUrl?: string;
  extra?: Record<string, unknown>;
}

/** Ordered HTTP work, or a static result, needed to discover models. */
export interface ModelListPlan {
  requests: ProviderHttpRequest[];
  staticModels?: ModelInfo[];
}

/** One normalized streaming increment. */
export interface StreamDelta {
  text: string;
  reasoning?: string;
}

export interface CompletionResult {
  text: string;
  reasoning?: string;
}

export interface ModelInfo {
  id: string;
  name?: string;
  description?: string;
  contextLength?: number;
  [key: string]: unknown;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly source?: ChatCompletionSource,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
