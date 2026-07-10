/**
 * Anthropic Claude request building.
 *
 * Portions derived from SillyTavern (https://github.com/SillyTavern/SillyTavern),
 * AGPL-3.0, commit 29e0df488, src/endpoints/backends/chat-completions.js:215.
 * Not ported in M1: tools, JSON schema, web search, prompt caching, media,
 * verbosity, or reverse-proxy credential handling.
 */

import {
  calculateClaudeBudgetTokens,
  convertClaudeMessages,
} from '../convert/prompt-converters.js';
import { API_URLS } from '../sources.js';
import { makePromptNames, type GenerationParams, type ProviderChatRequest } from '../types.js';
import { compactObject, requireApiKey } from './provider-helpers.js';

const DEFAULT_BETA_HEADERS = ['output-128k-2025-02-19', 'context-1m-2025-08-07'];

function messagesUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, '');
  return normalized.endsWith('/messages') ? normalized : `${normalized}/messages`;
}

export function buildClaudeRequest(params: GenerationParams): ProviderChatRequest {
  const apiKey = requireApiKey('claude', params.apiKey);
  const converted = convertClaudeMessages(
    structuredClone(params.messages),
    params.assistantPrefill ?? '',
    true,
    false,
    params.names ?? makePromptNames(),
  );

  const isFableModel = /claude-fable/.test(params.model);
  const useThinking =
    /^claude-(3-7|opus-4|sonnet-4|haiku-4-5|opus-4-5|opus-4-6|sonnet-4-6|opus-4-7)/.test(
      params.model,
    ) || isFableModel;
  const isLimitedSampling =
    /^claude-(opus-4-1|sonnet-4-5|haiku-4-5|opus-4-5|opus-4-6|sonnet-4-6)/.test(params.model);
  const noPrefillModel =
    /^claude-(opus-4-6|sonnet-4-6|opus-4-7)/.test(params.model) || isFableModel;
  const isAdaptiveModel = /^claude-(opus-4-7)/.test(params.model) || isFableModel;
  const noSamplingModel = /^claude-(opus-4-7)/.test(params.model) || isFableModel;

  const body = compactObject({
    system: converted.systemPrompt.length ? converted.systemPrompt : undefined,
    messages: converted.messages,
    model: params.model,
    max_tokens: params.maxTokens,
    stop_sequences: params.stop ?? [],
    temperature: params.temperature,
    top_p: params.topP,
    top_k: params.topK,
    stream: params.stream,
  });

  if (isLimitedSampling) {
    if (typeof body.top_p === 'number' && body.top_p < 1) {
      delete body.temperature;
    } else {
      delete body.top_p;
    }
  }
  if (noSamplingModel) {
    delete body.temperature;
    delete body.top_p;
    delete body.top_k;
  }

  let fixThinkingPrefill = false;
  if (useThinking && params.maxTokens !== undefined) {
    const effort = params.reasoningEffort ?? 'auto';
    const budget = calculateClaudeBudgetTokens(
      params.maxTokens,
      effort,
      params.stream,
      isAdaptiveModel,
    );

    if (typeof budget === 'string') {
      fixThinkingPrefill = true;
      body.thinking = compactObject({
        type: 'adaptive',
        display: noSamplingModel && params.includeReasoning ? 'summarized' : undefined,
      });
      body.output_config = { effort: budget };
      delete body.top_k;
    } else if (useThinking && isFableModel && effort === 'auto' && params.includeReasoning) {
      fixThinkingPrefill = true;
      body.thinking = { type: 'adaptive', display: 'summarized' };
    } else if (Number.isInteger(budget)) {
      fixThinkingPrefill = true;
      if (params.maxTokens <= 1024) {
        body.max_tokens = params.maxTokens + 1024;
      }
      body.thinking = { type: 'enabled', budget_tokens: budget };
      delete body.temperature;
      delete body.top_p;
      delete body.top_k;
    }
  }

  if ((fixThinkingPrefill || noPrefillModel) && converted.messages.at(-1)?.role === 'assistant') {
    converted.messages[converted.messages.length - 1]!.role = 'user';
  }

  return {
    url: messagesUrl(params.baseUrl?.trim() || API_URLS.claude),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'anthropic-beta': DEFAULT_BETA_HEADERS.join(','),
      'x-api-key': apiKey,
    },
    body,
  };
}
