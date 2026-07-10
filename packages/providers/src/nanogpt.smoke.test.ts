import { expect, it } from 'vitest';

import {
  buildChatRequest,
  buildModelListPlan,
  getStaticModels,
  normalizeStreamChunk,
  parseSseStream,
} from './index.js';

const apiKey = process.env.SMOKE_NANOGPT_KEY;
const smoke = apiKey ? it : it.skip;

it('exports the Phase 3 provider API', () => {
  expect(buildChatRequest).toBeTypeOf('function');
  expect(normalizeStreamChunk).toBeTypeOf('function');
  expect(parseSseStream).toBeTypeOf('function');
});

it('exports the Phase 4 model discovery API', () => {
  expect(buildModelListPlan).toBeTypeOf('function');
  expect(getStaticModels).toBeTypeOf('function');
});

smoke(
  'streams a live NanoGPT completion',
  async () => {
    const request = buildChatRequest('nanogpt', {
      model: process.env.SMOKE_NANOGPT_MODEL ?? 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Reply with exactly: brass' }],
      stream: true,
      apiKey,
      maxTokens: 16,
      temperature: 0,
    });

    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: JSON.stringify(request.body),
    });

    if (!response.ok) {
      throw new Error(
        `NanoGPT smoke request failed (${response.status}): ${await response.text()}`,
      );
    }
    expect(response.body).not.toBeNull();

    let text = '';
    for await (const event of parseSseStream(response.body!)) {
      if (event.data === '[DONE]') {
        break;
      }
      const delta = normalizeStreamChunk('nanogpt', JSON.parse(event.data));
      text += delta?.text ?? '';
    }

    expect(text.trim().toLowerCase()).toContain('brass');
  },
  30_000,
);
