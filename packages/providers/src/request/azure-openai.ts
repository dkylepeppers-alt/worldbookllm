/**
 * Azure OpenAI request building.
 *
 * Portions derived from SillyTavern (https://github.com/SillyTavern/SillyTavern),
 * AGPL-3.0, commit 29e0df488, src/endpoints/backends/chat-completions.js:1652.
 * Not ported in M1: tools, JSON schema, logprobs, or reverse proxies.
 */

import { ProviderError, type GenerationParams, type ProviderChatRequest } from '../types.js';
import { compactObject, extraString } from './provider-helpers.js';
import { getOpenAiReasoningEffort } from './openai-compatible.js';

export function buildAzureOpenAiRequest(params: GenerationParams): ProviderChatRequest {
  const baseUrl = params.baseUrl?.trim();
  const deploymentName = extraString(params.extra, 'deploymentName');
  const apiVersion = extraString(params.extra, 'apiVersion');
  if (!baseUrl || !deploymentName || !apiVersion || !params.apiKey) {
    throw new ProviderError(
      'Azure OpenAI requires a base URL, deployment name, API version, and API key.',
      'azure_openai',
    );
  }

  const url = new URL(
    `/openai/deployments/${encodeURIComponent(deploymentName)}/chat/completions`,
    baseUrl,
  );
  url.searchParams.set('api-version', apiVersion);
  return {
    url: url.toString(),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': params.apiKey,
    },
    body: compactObject({
      messages: structuredClone(params.messages),
      temperature: params.temperature,
      frequency_penalty: params.frequencyPenalty,
      presence_penalty: params.presencePenalty,
      top_p: params.topP,
      max_tokens: params.maxTokens,
      stream: params.stream,
      stop: params.stop,
      seed: params.seed,
      reasoning_effort: getOpenAiReasoningEffort(params.model, params.reasoningEffort),
    }),
  };
}
