import type { ChatMessage } from '@worldbookllm/providers';
import { describe, expect, it } from 'vitest';

import { compactEarlierTurns, fitEarlierTurns, supersedeRepeatedReads } from './context.js';

let nextId = 0;
function call(name: string, args: Record<string, unknown>, result: string): ChatMessage[] {
  const id = `call-${(nextId += 1)}`;
  return [
    {
      role: 'assistant',
      content: null,
      tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
    },
    { role: 'tool', tool_call_id: id, content: result },
  ];
}
function read(path: string, content: string, hash = 'a'.repeat(64)): ChatMessage[] {
  return call('read_file', { path }, JSON.stringify({ path, hash, content }));
}
const big = 'x'.repeat(30_000);
const args = (message: ChatMessage | undefined) =>
  JSON.parse(String(message!.tool_calls![0]!.function.arguments)) as Record<string, string>;

function turn(index: number, size: number): ChatMessage[] {
  return [
    { role: 'user', content: `Turn ${index}` },
    ...read(`chapters/chapter-${index}.md`, 'y'.repeat(size)),
    { role: 'assistant', content: `Done ${index}.` },
  ];
}
const isStubbed = (messages: ChatMessage[], index: number) =>
  messages.some(
    (message) =>
      message.role === 'tool' &&
      String(message.content).startsWith(`[chapters/chapter-${index}.md: read in an earlier turn`),
  );

describe('fitEarlierTurns', () => {
  it('replays earlier turns verbatim while they fit the budget', () => {
    const history = [...turn(1, 5_000), ...turn(2, 5_000)];
    expect(fitEarlierTurns(history, 50_000)).toEqual(history);
  });

  it('compacts the oldest turns once the history outgrows the budget', () => {
    const history = Array.from({ length: 8 }, (_, index) => turn(index + 1, 10_000)).flat();
    const fitted = fitEarlierTurns(history, 40_000);
    expect(JSON.stringify(fitted).length).toBeLessThan(45_000);
    expect(isStubbed(fitted, 1)).toBe(true);
    expect(isStubbed(fitted, 8)).toBe(false);
    expect(isStubbed(fitted, 7)).toBe(false);
    expect(fitted.filter((message) => message.role === 'user')).toHaveLength(8);
  });

  it('moves the boundary in half-budget steps, so the cached prefix rarely changes', () => {
    const turns = Array.from({ length: 12 }, (_, index) => turn(index + 1, 4_000));
    const boundaries = turns.map((_, count) => {
      const fitted = fitEarlierTurns(turns.slice(0, count + 1).flat(), 40_000);
      return turns.slice(0, count + 1).filter((_turn, index) => isStubbed(fitted, index + 1))
        .length;
    });
    // Monotonic, and it jumps a few turns at a time instead of one per turn.
    expect(boundaries).toEqual([...boundaries].sort((a, b) => a - b));
    expect(new Set(boundaries).size).toBeLessThan(boundaries.filter((b) => b > 0).length);
    expect(boundaries[0]).toBe(0);
  });

  it('keeps the latest earlier turn verbatim even when it alone is over budget', () => {
    const fitted = fitEarlierTurns([...turn(1, 30_000), ...turn(2, 30_000)], 20_000);
    expect(isStubbed(fitted, 1)).toBe(true);
    expect(isStubbed(fitted, 2)).toBe(false);
  });
});

describe('compactEarlierTurns', () => {
  it('replaces earlier file reads and skill loads with stubs that say how to get them back', () => {
    const messages = compactEarlierTurns([
      { role: 'user', content: 'Read Mira.' },
      ...read('characters/mira.md', big),
      ...call('activate_skill', { name: 'dialogue' }, `# Dialogue\n${big}`),
      { role: 'assistant', content: 'Done.' },
    ]);
    expect(messages[2]!.content).toMatch(/characters\/mira\.md.*earlier turn.*read_file again/u);
    expect(messages[2]!.content).not.toContain('xxxx');
    expect(messages[4]!.content).toMatch(/earlier turn.*activate_skill again/u);
    expect(messages[0]).toEqual({ role: 'user', content: 'Read Mira.' });
    expect(messages[5]).toEqual({ role: 'assistant', content: 'Done.' });
  });

  it('keeps the head of other long results, short results, and errors as they were', () => {
    const report = `exit code 1\n${'finding\n'.repeat(1000)}`;
    const messages = compactEarlierTurns([
      ...call('run_story', { command: 'validate' }, report),
      ...call('list_files', {}, 'story.md\nstyle-sheet.md'),
      ...call('read_file', { path: 'missing.md' }, 'Error: missing.md was not found'),
    ]);
    expect(String(messages[1]!.content).startsWith('exit code 1\nfinding')).toBe(true);
    expect(String(messages[1]!.content).length).toBeLessThan(800);
    expect(messages[1]!.content).toMatch(/omitted.*run the tool again/u);
    expect(messages[3]!.content).toBe('story.md\nstyle-sheet.md');
    expect(messages[5]!.content).toBe('Error: missing.md was not found');
  });

  it('drops the written text from earlier write_file and long edit_file calls', () => {
    const messages = compactEarlierTurns([
      ...call(
        'write_file',
        { path: 'characters/mira.md', content: big, expectedHash: null },
        'Wrote characters/mira.md',
      ),
      ...call(
        'edit_file',
        { path: 'characters/mira.md', find: big, replace: 'short' },
        'Edited characters/mira.md',
      ),
    ]);
    expect(args(messages[0])).toMatchObject({ path: 'characters/mira.md', expectedHash: null });
    expect(args(messages[0]).content).toMatch(/KB written in an earlier turn/u);
    expect(args(messages[2]).find).toMatch(/omitted from an earlier turn/u);
    expect(args(messages[2]).replace).toBe('short');
  });

  it('keeps the arguments of failed writes and edits for the model to correct', () => {
    const messages = compactEarlierTurns([
      ...call(
        'write_file',
        { path: 'characters/mira.md', content: big, expectedHash: null },
        'Error: characters/mira.md changed since it was read.',
      ),
      ...call(
        'edit_file',
        { path: 'characters/mira.md', find: big, replace: big },
        'Error: find text was not found.',
      ),
    ]);
    expect(args(messages[0]).content).toBe(big);
    expect(args(messages[2]).find).toBe(big);
    expect(args(messages[2]).replace).toBe(big);
  });
});

describe('supersedeRepeatedReads', () => {
  it('stubs a read once the same file is read again, keeping the latest read whole', () => {
    const messages = [
      ...read('characters/mira.md', `old ${big}`, 'b'.repeat(64)),
      ...read('characters/vess.md', big),
      ...read('characters/mira.md', `new ${big}`, 'c'.repeat(64)),
    ];
    supersedeRepeatedReads(messages);
    expect(messages[1]!.content).toMatch(/superseded by a later read_file/u);
    expect(messages[3]!.content).toContain(big);
    expect(messages[5]!.content).toContain(`new ${big}`);
  });

  it('treats the same path in another series book as a different file', () => {
    const messages = [
      ...call(
        'read_file',
        { path: 'story.md', book: 'tides' },
        JSON.stringify({ path: 'story.md', content: big }),
      ),
      ...read('story.md', big),
    ];
    supersedeRepeatedReads(messages);
    expect(messages[1]!.content).toContain(big);
  });

  it('stubs the content of a write once the written file has been read back', () => {
    const messages = [
      ...call(
        'write_file',
        { path: 'characters/mira.md', content: big, expectedHash: null },
        'Wrote characters/mira.md',
      ),
      ...read('characters/mira.md', big),
    ];
    supersedeRepeatedReads(messages);
    expect(args(messages[0]).content).toMatch(/superseded by a later read_file/u);
    expect(messages[3]!.content).toContain(big);
  });

  it('keeps a failed write whole even after the file is read again', () => {
    const messages = [
      ...call(
        'write_file',
        { path: 'characters/mira.md', content: big, expectedHash: null },
        'Error: characters/mira.md changed since it was read.',
      ),
      ...read('characters/mira.md', 'the version on disk'),
    ];
    supersedeRepeatedReads(messages);
    expect(args(messages[0]).content).toBe(big);
  });

  it('is stable when run again on the same messages', () => {
    const messages = [...read('a.md', big), ...read('a.md', big)];
    supersedeRepeatedReads(messages);
    const once = JSON.stringify(messages);
    supersedeRepeatedReads(messages);
    expect(JSON.stringify(messages)).toBe(once);
  });
});
