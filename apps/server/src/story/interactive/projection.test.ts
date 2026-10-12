import { describe, expect, it } from 'vitest';

import { projectInk } from './projection.js';

describe('the prose of an ink chapter', () => {
  it('keeps what a reader could see and drops the ink', () => {
    const body = [
      '// a note to self',
      'Waves {trust > 1: greet a friend|ignore a stranger} at the wall. -> next',
      'VAR x = 1',
      '~ trust += 1',
      '* {trust > 0} [Smile] back at her.',
      '  You smile. # mood: warm',
      '+ (stay) [Stay]',
      '- They talk <> and talk.',
      '{&Gulls cry.|Gulls wheel.}',
      '\\# A heading, kept, with a \\{brace\\} and a web address http:\\//x.org',
      '# break',
      '= cellar',
      '{ met:',
      '  - true: She knows you.',
      '  - else: She does not.',
      '}',
      '/* a block',
      'comment */',
      'The end. {name}',
    ].join('\n');
    expect(projectInk(body).split('\n\n')).toEqual([
      'Waves greet a friend ignore a stranger at the wall.',
      'Smile back at her.',
      'You smile.',
      'Stay',
      'They talk and talk.',
      'Gulls cry. Gulls wheel.',
      '# A heading, kept, with a {brace} and a web address http://x.org',
      '* * *',
      'She knows you.',
      'She does not.',
      'The end.',
    ]);
  });
});
