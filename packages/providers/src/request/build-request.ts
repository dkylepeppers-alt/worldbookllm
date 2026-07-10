/**
 * Provider request dispatcher.
 *
 * Portions derived from SillyTavern (https://github.com/SillyTavern/SillyTavern),
 * AGPL-3.0, commit 29e0df488, src/endpoints/backends/chat-completions.js.
 */

import {
  ProviderError,
  type ChatCompletionSource,
  type GenerationParams,
  type ProviderChatRequest,
} from '../types.js';
import { buildAi21Request } from './ai21.js';
import { buildAimlapiRequest } from './aimlapi.js';
import { buildAzureOpenAiRequest } from './azure-openai.js';
import { buildChutesRequest } from './chutes.js';
import { buildClaudeRequest } from './claude.js';
import { buildCohereRequest } from './cohere.js';
import { buildDeepSeekRequest } from './deepseek.js';
import { buildElectronHubRequest } from './electronhub.js';
import { buildGoogleRequest } from './google.js';
import { buildMistralRequest } from './mistral.js';
import { buildMinimaxRequest } from './minimax.js';
import { buildOpenAiCompatibleRequest, isOpenAiCompatibleSource } from './openai-compatible.js';
import { buildXaiRequest } from './xai.js';

export function buildChatRequest(
  source: ChatCompletionSource,
  params: GenerationParams,
): ProviderChatRequest {
  if (isOpenAiCompatibleSource(source)) {
    return buildOpenAiCompatibleRequest(source, params);
  }

  if (source === 'claude') {
    return buildClaudeRequest(params);
  }

  if (source === 'makersuite' || source === 'vertexai') {
    return buildGoogleRequest(source, params);
  }

  if (source === 'ai21') {
    return buildAi21Request(params);
  }

  if (source === 'mistralai') {
    return buildMistralRequest(params);
  }

  if (source === 'cohere') {
    return buildCohereRequest(params);
  }

  if (source === 'deepseek') {
    return buildDeepSeekRequest(params);
  }

  if (source === 'xai') {
    return buildXaiRequest(params);
  }

  if (source === 'aimlapi') {
    return buildAimlapiRequest(params);
  }

  if (source === 'electronhub') {
    return buildElectronHubRequest(params);
  }

  if (source === 'chutes') {
    return buildChutesRequest(params);
  }

  if (source === 'minimax') {
    return buildMinimaxRequest(params);
  }

  if (source === 'azure_openai') {
    return buildAzureOpenAiRequest(params);
  }

  source satisfies never;
  throw new ProviderError('Unsupported chat completion source.');
}
