import { describe, expect, it } from 'vitest';

import { lastJsonObject, readJsonReply } from './model-json.js';

describe('readJsonReply', () => {
  it('finds the JSON in prose, fences, and after a think block', () => {
    expect(readJsonReply('Here you go: {"a": 1} Hope it helps {b}')).toEqual({ a: 1 });
    expect(readJsonReply('```json\n{"a": [1, 2]}\n```')).toEqual({ a: [1, 2] });
    expect(readJsonReply('<think>maybe {"a": 0}?</think>{"a": 2}')).toEqual({ a: 2 });
    expect(readJsonReply('[{"name": "x"}]')).toEqual([{ name: 'x' }]);
    expect(readJsonReply('{"text": "a } inside"}')).toEqual({ text: 'a } inside' });
  });

  it('is undefined when nothing parses', () => {
    expect(readJsonReply('No variables needed.')).toBeUndefined();
    expect(readJsonReply('{not json}')).toBeUndefined();
  });
});

describe('lastJsonObject', () => {
  it('takes the call printed after planning, not an example earlier in the plan', () => {
    expect(
      lastJsonObject(
        'The format is {"title": "..."}. Now the call.{"title": "The Knock", "ink": "x"}',
      ),
    ).toEqual({ title: 'The Knock', ink: 'x' });
    expect(lastJsonObject('Read it. {"path": "a"} and then [1, 2]')).toEqual({ path: 'a' });
    expect(lastJsonObject('Nothing to call.')).toBeUndefined();
  });
});
