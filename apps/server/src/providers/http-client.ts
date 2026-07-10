import {
  ProviderError,
  type ChatCompletionSource,
  type ProviderHttpRequest,
} from '@worldbookllm/providers';

const MAX_JSON_BYTES = 2 * 1024 * 1024;

function requestInit(request: ProviderHttpRequest, signal: AbortSignal): RequestInit {
  const headers = new Headers(request.headers);
  let body: string | undefined;
  if (request.body !== undefined) {
    body = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
    if (typeof request.body !== 'string' && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
  }
  return { method: request.method, headers: Object.fromEntries(headers), body, signal };
}

async function readCapped(response: Response): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_JSON_BYTES) {
        await reader.cancel();
        throw new ProviderError('Provider response was too large.');
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function extractMessage(data: unknown, status: number): string {
  if (typeof data === 'object' && data !== null) {
    const record = data as Record<string, unknown>;
    if (typeof record.error === 'string') return record.error;
    if (typeof record.error === 'object' && record.error !== null) {
      const message = (record.error as Record<string, unknown>).message;
      if (typeof message === 'string') return message;
    }
    if (typeof record.message === 'string') return record.message;
  }
  return `Provider request failed (HTTP ${status})`;
}

function sensitiveValues(request: ProviderHttpRequest): string[] {
  const values: string[] = [];
  for (const [name, value] of Object.entries(request.headers)) {
    if (/authorization|api-key|x-api-key/iu.test(name)) {
      values.push(value);
      const bearer = value.match(/^Bearer\s+(.+)$/iu)?.[1];
      if (bearer) values.push(bearer);
    }
  }
  const url = new URL(request.url);
  for (const name of ['key', 'api_key']) {
    const value = url.searchParams.get(name);
    if (value) values.push(value);
  }
  return values.filter(Boolean).sort((a, b) => b.length - a.length);
}

function sanitize(message: string, request: ProviderHttpRequest): string {
  let safe = message.slice(0, 500);
  for (const value of sensitiveValues(request)) safe = safe.replaceAll(value, '[redacted]');
  return safe;
}

export class ProviderHttpClient {
  constructor(private readonly fetchImpl: typeof fetch) {}

  private async execute(
    source: ChatCompletionSource,
    request: ProviderHttpRequest,
    signal: AbortSignal,
  ): Promise<Response> {
    try {
      return await this.fetchImpl(request.url, requestInit(request, signal));
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError('Provider network request failed.', source);
    }
  }

  async fetchJson(
    source: ChatCompletionSource,
    request: ProviderHttpRequest,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const timeout = AbortSignal.timeout(30_000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await this.execute(source, request, combined);
    const text = await readCapped(response);
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw new ProviderError('Provider response was not valid JSON.', source, response.status);
    }
    if (!response.ok) {
      throw new ProviderError(
        sanitize(extractMessage(data, response.status), request),
        source,
        response.status,
      );
    }
    return data;
  }

  async fetchStream(
    source: ChatCompletionSource,
    request: ProviderHttpRequest,
    signal: AbortSignal,
  ): Promise<ReadableStream<Uint8Array>> {
    const response = await this.execute(source, request, signal);
    if (!response.ok) {
      const text = await readCapped(response);
      let data: unknown;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      throw new ProviderError(
        sanitize(extractMessage(data, response.status), request),
        source,
        response.status,
      );
    }
    if (!response.body) throw new ProviderError('Provider response had no streaming body.', source);
    return response.body;
  }
}
