import { describe, expect, it } from 'vitest';

import { makePromptNames } from '../types.js';
import {
  PROMPT_PLACEHOLDER,
  calculateClaudeBudgetTokens,
  calculateGoogleBudgetTokens,
  convertAI21Messages,
  convertClaudeMessages,
  convertCohereMessages,
  convertGooglePrompt,
  convertMistralMessages,
  convertXAIMessages,
  mergeMessages,
  postProcessPrompt,
} from './prompt-converters.js';

const names = makePromptNames({ charName: 'Assistant', userName: 'User' });

function chat() {
  return [
    { role: 'system', content: 'You are a worldbuilding assistant.' },
    { role: 'system', content: 'Sources:\nThe moon is made of brass.' },
    { role: 'user', content: 'What is the moon made of?' },
    { role: 'assistant', content: 'Brass, according to your canon.' },
    { role: 'user', content: 'Expand on that.' },
  ];
}

describe('convertClaudeMessages', () => {
  it('extracts leading system messages into systemPrompt and converts content to parts', () => {
    const { messages, systemPrompt } = convertClaudeMessages(chat(), '', true, false, names);

    expect(systemPrompt).toEqual([
      { type: 'text', text: 'You are a worldbuilding assistant.' },
      { type: 'text', text: 'Sources:\nThe moon is made of brass.' },
    ]);
    expect(messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'What is the moon made of?' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Brass, according to your canon.' }] },
      { role: 'user', content: [{ type: 'text', text: 'Expand on that.' }] },
    ]);
  });

  it('adds a placeholder user message when only system messages exist', () => {
    const { messages } = convertClaudeMessages(
      [{ role: 'system', content: 'sys' }],
      '',
      true,
      false,
      names,
    );
    expect(messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: PROMPT_PLACEHOLDER }] },
    ]);
  });

  it('appends a trimmed assistant prefill', () => {
    const { messages } = convertClaudeMessages(
      [{ role: 'user', content: 'hi' }],
      'Sure: ',
      true,
      false,
      names,
    );
    expect(messages[messages.length - 1]).toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: 'Sure:' }],
    });
  });

  it('merges consecutive same-role messages and demotes mid-chat system to user', () => {
    const { messages } = convertClaudeMessages(
      [
        { role: 'user', content: 'a' },
        { role: 'system', content: 'note' },
        { role: 'user', content: 'b' },
      ],
      '',
      true,
      false,
      names,
    );
    expect(messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'a' },
          { type: 'text', text: 'note' },
          { type: 'text', text: 'b' },
        ],
      },
    ]);
  });

  it('replaces empty text with a zero-width space', () => {
    const { messages } = convertClaudeMessages(
      [{ role: 'user', content: [{ type: 'text', text: '' }] }],
      '',
      true,
      false,
      names,
    );
    expect(messages[0].content).toEqual([{ type: 'text', text: '​' }]);
  });
});

describe('convertGooglePrompt', () => {
  it('builds system_instruction and contents with model roles', () => {
    const { contents, system_instruction } = convertGooglePrompt(
      chat(),
      'gemini-2.0-flash',
      true,
      names,
    );

    expect(system_instruction.parts.map((p) => p.text)).toEqual([
      'You are a worldbuilding assistant.',
      'Sources:\nThe moon is made of brass.',
    ]);
    expect(contents).toEqual([
      { role: 'user', parts: [{ text: 'What is the moon made of?' }] },
      { role: 'model', parts: [{ text: 'Brass, according to your canon.' }] },
      { role: 'user', parts: [{ text: 'Expand on that.' }] },
    ]);
  });

  it('merges consecutive same-role text parts with double newlines', () => {
    const { contents } = convertGooglePrompt(
      [
        { role: 'user', content: 'a' },
        { role: 'user', content: 'b' },
      ],
      'gemini-2.0-flash',
      true,
      names,
    );
    expect(contents).toEqual([{ role: 'user', parts: [{ text: 'a\n\nb' }] }]);
  });

  it('keeps the last system message when there is nothing else (length > 1 guard)', () => {
    const { contents, system_instruction } = convertGooglePrompt(
      [{ role: 'system', content: 'only' }],
      'gemini-2.0-flash',
      true,
      names,
    );
    expect(system_instruction.parts).toEqual([]);
    expect(contents).toEqual([{ role: 'user', parts: [{ text: 'only' }] }]);
  });
});

describe('convertCohereMessages', () => {
  it('prefixes named messages and strips names', () => {
    const { chatHistory } = convertCohereMessages(
      [
        { role: 'system', content: 'ex', name: 'example_user' },
        { role: 'user', content: 'hello', name: 'Kyle' },
      ],
      names,
    );
    expect(chatHistory).toEqual([
      { role: 'system', content: 'User: ex' },
      { role: 'user', content: 'Kyle: hello' },
    ]);
  });

  it('inserts a placeholder for empty input', () => {
    const { chatHistory } = convertCohereMessages([], names);
    expect(chatHistory).toEqual([{ role: 'user', content: PROMPT_PLACEHOLDER }]);
  });
});

describe('convertAI21Messages', () => {
  it('squashes leading system messages and merges consecutive roles', () => {
    const out = convertAI21Messages(chat(), names);
    expect(out).toEqual([
      {
        role: 'system',
        content: 'You are a worldbuilding assistant.\n\nSources:\nThe moon is made of brass.',
      },
      { role: 'user', content: 'What is the moon made of?' },
      { role: 'assistant', content: 'Brass, according to your canon.' },
      { role: 'user', content: 'Expand on that.' },
    ]);
  });
});

describe('convertMistralMessages', () => {
  it('turns a system message following an assistant into a user message', () => {
    const out = convertMistralMessages(
      [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: 'a' },
        { role: 'system', content: 'note' },
        { role: 'user', content: 'q2' },
      ],
      names,
    );
    expect(out.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'user']);
  });

  it('does not mark a trailing assistant message as prefix by default (ST default config)', () => {
    const out = convertMistralMessages(
      [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: 'partial' },
      ],
      names,
    );
    expect(out[1].prefix).toBeUndefined();
  });
});

describe('convertXAIMessages', () => {
  it('prefixes named assistant messages with the char name', () => {
    const out = convertXAIMessages(
      [
        { role: 'assistant', content: 'hello', name: 'anything' },
        { role: 'user', content: 'hi', name: 'Kyle' },
      ],
      names,
    );
    expect(out[0]).toEqual({ role: 'assistant', content: 'Assistant: hello' });
    // user messages keep their name untouched
    expect(out[1]).toEqual({ role: 'user', content: 'hi', name: 'Kyle' });
  });
});

describe('mergeMessages', () => {
  it('squashes consecutive same-role messages', () => {
    const out = mergeMessages(
      [
        { role: 'system', content: 's1' },
        { role: 'system', content: 's2' },
        { role: 'user', content: 'u1' },
        { role: 'user', content: 'u2' },
      ],
      names,
      {},
    );
    expect(out).toEqual([
      { role: 'system', content: 's1\n\ns2' },
      { role: 'user', content: 'u1\n\nu2' },
    ]);
  });

  it('strict mode demotes mid-prompt system messages and re-merges', () => {
    const out = mergeMessages(
      [
        { role: 'system', content: 's' },
        { role: 'user', content: 'u' },
        { role: 'system', content: 'mid' },
        { role: 'user', content: 'u2' },
      ],
      names,
      { strict: true },
    );
    expect(out).toEqual([
      { role: 'system', content: 's' },
      { role: 'user', content: 'u\n\nmid\n\nu2' },
    ]);
  });

  it('strict + placeholders inserts a user message after a lone system message', () => {
    const out = mergeMessages(
      [
        { role: 'system', content: 's' },
        { role: 'assistant', content: 'a' },
      ],
      names,
      { strict: true, placeholders: true },
    );
    expect(out).toEqual([
      { role: 'system', content: 's' },
      { role: 'user', content: PROMPT_PLACEHOLDER },
      { role: 'assistant', content: 'a' },
    ]);
  });

  it('single mode collapses everything into one user message with name prefixes', () => {
    const out = mergeMessages(
      [
        { role: 'system', content: 's' },
        { role: 'user', content: 'u' },
        { role: 'assistant', content: 'a' },
      ],
      names,
      { strict: true, single: true },
    );
    expect(out).toEqual([{ role: 'user', content: 's\n\nUser: u\n\nAssistant: a' }]);
  });
});

describe('postProcessPrompt', () => {
  it('returns messages unchanged for NONE', () => {
    const input = chat();
    const out = postProcessPrompt(structuredClone(input), '', names);
    expect(out).toEqual(input);
  });

  it('applies merge for MERGE', () => {
    const out = postProcessPrompt(chat(), 'merge', names);
    expect(out[0]).toEqual({
      role: 'system',
      content: 'You are a worldbuilding assistant.\n\nSources:\nThe moon is made of brass.',
    });
  });
});

describe('calculateClaudeBudgetTokens', () => {
  it('matches ST behavior for traditional thinking models', () => {
    expect(calculateClaudeBudgetTokens(8192, 'auto', true, false)).toBeNull();
    expect(calculateClaudeBudgetTokens(8192, 'min', true, false)).toBe(1024);
    expect(calculateClaudeBudgetTokens(8192, 'low', true, false)).toBe(1024);
    expect(calculateClaudeBudgetTokens(40000, 'medium', true, false)).toBe(10000);
    expect(calculateClaudeBudgetTokens(40000, 'max', false, false)).toBe(21333);
  });

  it('returns effort strings for adaptive models', () => {
    expect(calculateClaudeBudgetTokens(8192, 'medium', true, true)).toBe('medium');
    expect(calculateClaudeBudgetTokens(8192, 'auto', true, true)).toBeNull();
  });
});

describe('calculateGoogleBudgetTokens', () => {
  it('matches ST behavior per model family', () => {
    expect(calculateGoogleBudgetTokens(8192, 'auto', 'gemini-2.5-flash')).toBe(-1);
    expect(calculateGoogleBudgetTokens(8192, 'min', 'gemini-2.5-flash')).toBe(0);
    expect(calculateGoogleBudgetTokens(100000, 'medium', 'gemini-2.5-flash')).toBe(24576);
    // 'min' early-returns 0 before the 512 floor is applied (ST behavior)
    expect(calculateGoogleBudgetTokens(8192, 'min', 'gemini-2.5-flash-lite')).toBe(0);
    expect(calculateGoogleBudgetTokens(1024, 'low', 'gemini-2.5-flash-lite')).toBe(512);
    expect(calculateGoogleBudgetTokens(8192, 'min', 'gemini-2.5-pro')).toBe(128);
    expect(calculateGoogleBudgetTokens(8192, 'min', 'gemini-3-flash')).toBe('minimal');
    expect(calculateGoogleBudgetTokens(8192, 'medium', 'gemini-3-pro')).toBe('low');
    expect(calculateGoogleBudgetTokens(8192, 'high', 'unknown-model')).toBeNull();
  });
});
