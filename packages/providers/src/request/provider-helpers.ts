/** Shared helpers for dedicated provider request ports. */

import { PROVIDER_META } from '../sources.js';
import { ProviderError, type ChatCompletionSource } from '../types.js';

export function compactObject(object: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

export function extraString(
  extra: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = extra?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function extraBoolean(
  extra: Record<string, unknown> | undefined,
  key: string,
): boolean | undefined {
  const value = extra?.[key];
  return typeof value === 'boolean' ? value : undefined;
}

export function requireApiKey(source: ChatCompletionSource, apiKey: string | undefined): string {
  if (!apiKey) {
    throw new ProviderError(`${PROVIDER_META[source].label} requires an API key.`, source);
  }
  return apiKey;
}

export function chatCompletionsUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, '');
  return normalized.endsWith('/chat/completions') ? normalized : `${normalized}/chat/completions`;
}
