import { describe, expect, it } from 'vitest';

import { ToolCallAccumulator } from './tool-calls.js';

function collect(chunks: unknown[]) {
  const accumulator = new ToolCallAccumulator();
  for (const chunk of chunks) accumulator.push(chunk);
  return accumulator.toolCalls();
}

describe('ToolCallAccumulator', () => {
  it('joins OpenAI-style argument fragments across chunks, per call index', () => {
    const calls = collect([
      { choices: [{ index: 0, delta: { role: 'assistant', content: null } }] },
      {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_a',
                  type: 'function',
                  function: { name: 'read_file', arguments: '' },
                },
              ],
            },
          },
        ],
      },
      {
        choices: [
          { index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"path":' } }] } },
        ],
      },
      {
        choices: [
          { index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"x.md"}' } }] } },
        ],
      },
      {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 1,
                  id: 'call_b',
                  function: { name: 'search', arguments: '{"query":"bell"}' },
                },
              ],
            },
          },
        ],
      },
      { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    ]);
    expect(calls).toEqual([
      { id: 'call_a', name: 'read_file', arguments: '{"path":"x.md"}' },
      { id: 'call_b', name: 'search', arguments: '{"query":"bell"}' },
    ]);
  });

  it('ignores choices other than the first and text-only streams', () => {
    expect(
      collect([
        { choices: [{ index: 0, delta: { content: 'Hello' } }] },
        {
          choices: [
            {
              index: 1,
              delta: { tool_calls: [{ index: 0, id: 'x', function: { name: 'nope' } }] },
            },
          ],
        },
      ]),
    ).toEqual([]);
  });

  it('builds Claude tool_use blocks from input_json_delta fragments', () => {
    const calls = collect([
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Checking.' } },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: {} },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{"path": "x' },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '.md"}' },
      },
      { type: 'content_block_stop', index: 1 },
    ]);
    expect(calls).toEqual([{ id: 'toolu_1', name: 'read_file', arguments: '{"path":"x.md"}' }]);
  });

  it('keeps unparseable Claude input as raw text for the caller to report', () => {
    const calls = collect([
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'toolu_2', name: 'search' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"query":' },
      },
      { type: 'content_block_stop', index: 0 },
    ]);
    expect(calls).toEqual([{ id: 'toolu_2', name: 'search', arguments: '{"query":' }]);
  });

  it('collects Gemini functionCall parts with generated ids and thought signatures', () => {
    const calls = collect([
      {
        candidates: [
          {
            content: {
              parts: [
                { text: 'Let me look.' },
                {
                  functionCall: { name: 'read_file', args: { path: 'x.md' } },
                  thoughtSignature: 'sig-1',
                },
              ],
            },
          },
        ],
      },
      {
        candidates: [{ content: { parts: [{ functionCall: { name: 'list_files', args: {} } }] } }],
      },
    ]);
    expect(calls).toEqual([
      {
        id: expect.stringMatching(/^call_/u),
        name: 'read_file',
        arguments: '{"path":"x.md"}',
        signature: 'sig-1',
      },
      { id: expect.stringMatching(/^call_/u), name: 'list_files', arguments: '{}' },
    ]);
    expect(calls[0]?.id).not.toBe(calls[1]?.id);
  });

  it('collects Cohere v2 tool-call events', () => {
    const calls = collect([
      { type: 'message-start', delta: { message: { role: 'assistant' } } },
      {
        type: 'tool-call-start',
        index: 0,
        delta: {
          message: {
            tool_calls: {
              id: 'cohere_1',
              type: 'function',
              function: { name: 'read_file', arguments: '' },
            },
          },
        },
      },
      {
        type: 'tool-call-delta',
        index: 0,
        delta: { message: { tool_calls: { function: { arguments: '{"path":"x.md"}' } } } },
      },
      { type: 'tool-call-end', index: 0, delta: { message: {} } },
    ]);
    expect(calls).toEqual([{ id: 'cohere_1', name: 'read_file', arguments: '{"path":"x.md"}' }]);
  });

  it('ignores prototype keys in deltas', () => {
    const accumulator = new ToolCallAccumulator();
    accumulator.push(
      JSON.parse(
        '{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"c","function":{"name":"x"},"__proto__":{"polluted":true}}]}}]}',
      ),
    );
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(accumulator.toolCalls()).toEqual([{ id: 'c', name: 'x', arguments: '{}' }]);
  });
});
