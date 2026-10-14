import { describe, expect, it } from 'vitest';

import { splitFlags } from './tools.js';

describe('run_story arguments', () => {
  it('moves flags a model wrote into args into options, so they do not become part of a name', () => {
    expect(splitFlags('add', ['character', 'Wren Adair', '--role', 'protagonist'], {})).toEqual({
      args: ['character', 'Wren Adair'],
      options: { role: 'protagonist' },
    });
    expect(
      splitFlags('add', ['location', 'Harrowmere', '--type=city', '--character', 'wren'], {
        character: 'ilse',
      }),
    ).toEqual({
      args: ['location', 'Harrowmere'],
      options: { type: 'city', character: ['ilse', 'wren'] },
    });
  });

  it('keeps plain args and options as they are, and names a flag the command does not take', () => {
    expect(splitFlags('add', ['character', 'Mara'], { role: 'minor' })).toEqual({
      args: ['character', 'Mara'],
      options: { role: 'minor' },
    });
    expect(() => splitFlags('add', ['character', 'Mara', '--colour', 'red'], {})).toThrow(
      'story add does not accept --colour',
    );
    expect(() => splitFlags('add', ['character', 'Mara', '--role'], {})).toThrow(
      '--role needs a value.',
    );
  });
});
