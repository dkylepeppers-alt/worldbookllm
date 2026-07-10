/**
 * Google AI Studio and Vertex AI request building.
 *
 * Portions derived from SillyTavern (https://github.com/SillyTavern/SillyTavern),
 * AGPL-3.0, commit 29e0df488, src/endpoints/backends/chat-completions.js:428.
 * Not ported in M1: tools, JSON schema, web search, media, signatures,
 * reverse proxies, or service-account token exchange execution.
 */

import { calculateGoogleBudgetTokens, convertGooglePrompt } from '../convert/prompt-converters.js';
import { API_URLS } from '../sources.js';
import {
  makePromptNames,
  ProviderError,
  type GenerationParams,
  type ProviderChatRequest,
} from '../types.js';
import { compactObject, extraString, requireApiKey } from './provider-helpers.js';

type GoogleSource = 'makersuite' | 'vertexai';

const GEMINI_SAFETY = [
  'HARM_CATEGORY_HARASSMENT',
  'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT',
  'HARM_CATEGORY_CIVIC_INTEGRITY',
].map((category) => ({ category, threshold: 'OFF' }));

const VERTEX_SAFETY = [
  'HARM_CATEGORY_IMAGE_HATE',
  'HARM_CATEGORY_IMAGE_DANGEROUS_CONTENT',
  'HARM_CATEGORY_IMAGE_HARASSMENT',
  'HARM_CATEGORY_IMAGE_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_JAILBREAK',
].map((category) => ({ category, threshold: 'OFF' }));

function responseType(stream: boolean): string {
  return stream ? 'streamGenerateContent' : 'generateContent';
}

function studioUrl(params: GenerationParams, apiKey: string): string {
  const base = (params.baseUrl?.trim() || API_URLS.makersuite).replace(/\/+$/, '');
  return `${base}/v1beta/models/${params.model}:${responseType(params.stream)}?key=${apiKey}${params.stream ? '&alt=sse' : ''}`;
}

function vertexUrl(
  params: GenerationParams,
  authMode: string,
  credential: string,
): { url: string; headers: Record<string, string> } {
  const region = extraString(params.extra, 'region') ?? 'us-central1';
  const projectId = extraString(params.extra, 'projectId');
  const operation = responseType(params.stream);
  const suffix = params.stream ? '?alt=sse' : '';

  if (authMode === 'express') {
    const base =
      region === 'global'
        ? 'https://aiplatform.googleapis.com'
        : `https://${region}-aiplatform.googleapis.com`;
    const path = projectId
      ? `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/publishers/google/models/${params.model}:${operation}`
      : `${base}/v1/publishers/google/models/${params.model}:${operation}`;
    return {
      url: `${path}?key=${credential}${params.stream ? '&alt=sse' : ''}`,
      headers: { 'Content-Type': 'application/json' },
    };
  }

  if (authMode === 'full') {
    if (!projectId) {
      throw new ProviderError('Google Vertex AI Full mode requires a project ID.', 'vertexai');
    }
    const base =
      region === 'global'
        ? 'https://aiplatform.googleapis.com'
        : `https://${region}-aiplatform.googleapis.com`;
    return {
      url: `${base}/v1/projects/${projectId}/locations/${region}/publishers/google/models/${params.model}:${operation}${suffix}`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${credential}`,
      },
    };
  }

  throw new ProviderError(`Unsupported Vertex AI authentication mode: ${authMode}`, 'vertexai');
}

export function buildGoogleRequest(
  source: GoogleSource,
  params: GenerationParams,
): ProviderChatRequest {
  const isVertex = source === 'vertexai';
  const authMode = isVertex ? (extraString(params.extra, 'authMode') ?? 'express') : 'api_key';
  const credential = (() => {
    if (!isVertex || authMode === 'express') {
      return requireApiKey(source, params.apiKey);
    }
    if (authMode === 'full') {
      const token = extraString(params.extra, 'accessToken');
      if (!token) {
        throw new ProviderError('Google Vertex AI Full mode requires an access token.', 'vertexai');
      }
      return token;
    }
    throw new ProviderError(`Unsupported Vertex AI authentication mode: ${authMode}`, 'vertexai');
  })();

  const prompt = convertGooglePrompt(
    structuredClone(params.messages),
    params.model,
    !/gemma-3/.test(params.model),
    params.names ?? makePromptNames(),
  );
  const generationConfig = compactObject({
    stopSequences: params.stop?.length ? params.stop : undefined,
    candidateCount: 1,
    maxOutputTokens: params.maxTokens,
    temperature: params.temperature,
    topP: params.topP,
    topK: params.topK || undefined,
    seed: params.seed,
  });

  const supportsThinking =
    (/^gemini-2\.5-(flash|pro)/.test(params.model) && !/-image(-preview)?$/.test(params.model)) ||
    /^gemini-3[.\d]*-(flash|pro)/.test(params.model);
  if (supportsThinking && params.maxTokens !== undefined) {
    const budget = calculateGoogleBudgetTokens(
      params.maxTokens,
      params.reasoningEffort ?? 'auto',
      params.model,
    );
    const thinkingConfig = compactObject({ includeThoughts: Boolean(params.includeReasoning) });
    if (typeof budget === 'number' && Number.isInteger(budget)) {
      thinkingConfig.thinkingBudget = budget;
    } else if (typeof budget === 'string' && budget) {
      thinkingConfig.thinkingLevel = budget;
    }
    if (isVertex && budget === 0 && thinkingConfig.includeThoughts) {
      thinkingConfig.includeThoughts = false;
    }
    generationConfig.thinkingConfig = thinkingConfig;
  }

  const body: Record<string, unknown> = {
    contents: prompt.contents,
    safetySettings: [...GEMINI_SAFETY, ...(isVertex ? VERTEX_SAFETY : [])],
    generationConfig,
  };
  if (prompt.system_instruction.parts.length) {
    body.systemInstruction = prompt.system_instruction;
  }

  const target = isVertex
    ? vertexUrl(params, authMode, credential)
    : { url: studioUrl(params, credential), headers: { 'Content-Type': 'application/json' } };
  return { url: target.url, method: 'POST', headers: target.headers, body };
}
