import { describe, expect, it } from 'vitest';

import { ProviderError } from '../types.js';
import { normalizeStreamChunk } from './normalize.js';

describe('normalizeStreamChunk', () => {
  it('extracts an OpenAI content delta', () => {
    expect(normalizeStreamChunk('openai', { choices: [{ delta: { content: 'Brass' } }] })).toEqual({
      text: 'Brass',
    });
  });

  it('returns reasoning without inventing visible text', () => {
    expect(
      normalizeStreamChunk('nanogpt', {
        choices: [{ delta: { reasoning_content: 'I should check the canon.' } }],
      }),
    ).toEqual({ text: '', reasoning: 'I should check the canon.' });
  });

  it('supports OpenRouter reasoning and message-content fallbacks', () => {
    expect(
      normalizeStreamChunk('openrouter', {
        choices: [{ message: { content: 'Answer', reasoning: 'Thought' } }],
      }),
    ).toEqual({ text: 'Answer', reasoning: 'Thought' });
  });

  it('falls back to text-completion chunks', () => {
    expect(normalizeStreamChunk('custom', { choices: [{ text: 'legacy-compatible' }] })).toEqual({
      text: 'legacy-compatible',
    });
  });

  it('ignores role-only and finish chunks', () => {
    expect(
      normalizeStreamChunk('groq', {
        choices: [{ delta: { role: 'assistant' }, finish_reason: 'stop' }],
      }),
    ).toBeNull();
  });

  it('turns provider error chunks into ProviderError', () => {
    expect(() => normalizeStreamChunk('openai', { error: { message: 'quota exceeded' } })).toThrow(
      new ProviderError('quota exceeded', 'openai'),
    );
  });

  it('preserves string-shaped provider errors', () => {
    expect(() => normalizeStreamChunk('custom', { error: 'rate limited' })).toThrow(
      new ProviderError('rate limited', 'custom'),
    );
  });

  it('uses a top-level message for boolean provider errors', () => {
    expect(() =>
      normalizeStreamChunk('nanogpt', { error: true, message: 'billing unavailable' }),
    ).toThrow(new ProviderError('billing unavailable', 'nanogpt'));
  });

  it('recognizes a top-level error message without choices', () => {
    expect(() =>
      normalizeStreamChunk('groq', { message: 'request rejected', status: 400 }),
    ).toThrow(new ProviderError('request rejected', 'groq', 400));
  });
});
