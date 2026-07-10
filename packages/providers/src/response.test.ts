import { describe, expect, it } from 'vitest';

import { parseCompletionResponse } from './response.js';
import { ProviderError } from './types.js';

describe('parseCompletionResponse', () => {
  it('extracts OpenAI message content and reasoning', () => {
    expect(
      parseCompletionResponse('openai', {
        choices: [
          {
            message: {
              content: 'The moon is brass.',
              reasoning_content: 'The source states its material.',
            },
          },
        ],
      }),
    ).toEqual({
      text: 'The moon is brass.',
      reasoning: 'The source states its material.',
    });
  });

  it('uses OpenRouter reasoning fields', () => {
    expect(
      parseCompletionResponse('openrouter', {
        choices: [{ message: { content: 'Answer', reasoning: 'Thought' } }],
      }),
    ).toEqual({ text: 'Answer', reasoning: 'Thought' });
  });

  it('joins text content parts', () => {
    expect(
      parseCompletionResponse('custom', {
        choices: [
          { message: { content: [{ type: 'text', text: 'part one' }, { text: ' + two' }] } },
        ],
      }),
    ).toEqual({ text: 'part one + two' });
  });

  it('supports text-completion response shapes', () => {
    expect(parseCompletionResponse('custom', { choices: [{ text: 'plain text' }] })).toEqual({
      text: 'plain text',
    });
  });

  it('preserves provider error status', () => {
    let error: unknown;
    try {
      parseCompletionResponse('groq', {
        error: { message: 'rate limited', status: 429 },
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toEqual(new ProviderError('rate limited', 'groq', 429));
  });

  it('rejects a response with no completion data', () => {
    expect(() => parseCompletionResponse('nanogpt', { choices: [] })).toThrow(
      new ProviderError('Provider response did not contain completion data.', 'nanogpt'),
    );
  });
});
