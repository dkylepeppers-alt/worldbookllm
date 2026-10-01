import type { AgentMessage } from '@worldbookllm/shared';
import { describe, expect, it } from 'vitest';

import { applyAgentEvent, extraText, startTurn, toolTarget, seriesBooksOf } from './agent-turns.js';

function message(content: string, texts: string[]): AgentMessage {
  return {
    id: '0c8f34e8-96b5-4c62-8f2e-27e6a9f14d55',
    chatId: '60a0bf0c-031d-497c-9c1a-2f68441936a6',
    seq: 1,
    role: 'assistant',
    content,
    reasoning: null,
    status: 'complete',
    note: null,
    pinnedPaths: [],
    steps: texts.map((text, index) => ({ index, requestBody: {}, text, toolCalls: [] })),
    checkpointId: null,
    createdAt: '2026-09-30T12:00:00.000Z',
    updatedAt: '2026-09-30T12:00:00.000Z',
  };
}

describe('applyAgentEvent', () => {
  it('retains every book affected by streamed series checkpoints', () => {
    const checkpoint = {
      id: '0c8f34e8-96b5-4c62-8f2e-27e6a9f14d55',
      book: 'low-water',
      label: 'Series push',
      actor: 'agent' as const,
      createdAt: '2026-09-30T00:00:00.000Z',
      undoneAt: null,
      files: [],
    };
    let turn = applyAgentEvent(startTurn('Sync canon'), {
      type: 'series_sync',
      checkpoints: [checkpoint],
    });
    turn = applyAgentEvent(turn, {
      type: 'series_sync',
      checkpoints: [{ ...checkpoint, book: 'high-water' }],
    });
    expect(turn.seriesBooks).toEqual(['low-water', 'high-water']);
  });

  it('recovers affected books from a persisted sync tool result', () => {
    expect(
      seriesBooksOf([
        {
          index: 0,
          text: '',
          calls: [
            {
              id: 'sync',
              name: 'sync_series',
              arguments: '{}',
              status: 'ok',
              result: '{"books":["tides","low-water","tides"]}',
            },
          ],
        },
      ]),
    ).toEqual(['tides', 'low-water']);
  });
  it('builds steps with streamed text and tool calls that settle', () => {
    let turn = startTurn('Check the cast');
    turn = applyAgentEvent(turn, { type: 'step', index: 0 });
    turn = applyAgentEvent(turn, { type: 'delta', text: 'Looking', reasoning: 'hmm' });
    turn = applyAgentEvent(turn, {
      type: 'tool_call',
      stepIndex: 0,
      id: 'c1',
      name: 'read_file',
      arguments: '{"path":"story.md"}',
    });
    expect(turn.steps[0]?.calls[0]?.status).toBe('running');
    turn = applyAgentEvent(turn, {
      type: 'tool_result',
      stepIndex: 0,
      id: 'c1',
      ok: false,
      summary: 'not found',
    });
    turn = applyAgentEvent(turn, { type: 'step', index: 1 });
    turn = applyAgentEvent(turn, { type: 'delta', text: 'Done.' });
    expect(turn.reasoning).toBe('hmm');
    expect(turn.steps).toEqual([
      {
        index: 0,
        text: 'Looking',
        calls: [
          {
            id: 'c1',
            name: 'read_file',
            arguments: '{"path":"story.md"}',
            status: 'failed',
            result: 'not found',
          },
        ],
      },
      { index: 1, text: 'Done.', calls: [] },
    ]);
  });
});

describe('extraText', () => {
  it('returns what the content adds beyond the step texts', () => {
    expect(extraText(message('A\n\nB', ['A', 'B']))).toBe('');
    expect(extraText(message('A\n\n(Stopped after 24 steps.)', ['A', '']))).toBe(
      '(Stopped after 24 steps.)',
    );
    expect(extraText(message('Only content', []))).toBe('Only content');
  });
});

describe('toolTarget', () => {
  it('names the file, query, or story command a call acted on', () => {
    expect(toolTarget('{"path":"characters/mara.md","content":"x"}')).toBe('characters/mara.md');
    expect(toolTarget('{"query":"salt"}')).toBe('salt');
    expect(toolTarget('{"command":"add","args":["character","Mara"]}')).toBe('add character Mara');
    expect(toolTarget('not json')).toBeNull();
    expect(toolTarget('{}')).toBeNull();
  });
});
