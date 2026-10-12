import { describe, expect, it } from 'vitest';

import { readEnding, writeEnding } from './ending.js';

describe('a chapter ending', () => {
  it('reads closing choices with conditions, effects, and diverts, and writes them back', () => {
    const body = [
      'The lamp is dark.',
      '',
      '* {trust > 1 and not met} [Light the \\[old\\] lamp]',
      '    ~ lamp_lit = true',
      '    ~ trust += 1',
      '    -> chapter_02',
      '+ [Wait] -> chapter_03.cellar',
      '',
    ].join('\n');
    const read = readEnding(body);
    expect(read).toEqual({
      editable: true,
      reason: null,
      before: 'The lamp is dark.',
      ending: {
        then: 'END',
        choices: [
          {
            text: 'Light the [old] lamp',
            once: true,
            condition: 'trust > 1 and not met',
            effects: ['lamp_lit = true', 'trust += 1'],
            to: 'chapter_02',
          },
          { text: 'Wait', once: false, condition: '', effects: [], to: 'chapter_03.cellar' },
        ],
      },
    });
    expect(writeEnding(read.before, read.ending)).toBe(`${body.trimEnd()}\n`);
  });

  it('reads a plain divert, prose to the end, and an empty chapter', () => {
    expect(readEnding('Go on.\n-> chapter_02\n')).toMatchObject({
      editable: true,
      before: 'Go on.',
      ending: { choices: [], then: 'chapter_02' },
    });
    expect(readEnding('Just prose.\n')).toMatchObject({
      editable: true,
      before: 'Just prose.',
      ending: { choices: [], then: 'END' },
    });
    expect(writeEnding('', { choices: [], then: 'END' })).toBe('-> END\n');
  });

  it('leaves endings it cannot show to the ink editor', () => {
    expect(readEnding('* [A]\n  She waits.\n* [B] -> b\n').editable).toBe(false);
    expect(readEnding('* [A] -> a\n-> b\n').editable).toBe(false);
    expect(readEnding('* [A] -> a\n    ~ x = 1\n').editable).toBe(false);
    expect(readEnding('* [A]\n    ~ x = 1\n').editable).toBe(false);
    expect(readEnding('* [A]\n  ** [Deeper] -> a\n').editable).toBe(false);
  });
});
