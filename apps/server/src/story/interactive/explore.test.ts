import { describe, expect, it } from 'vitest';

import { explorePaths } from './explore.js';
import { readInkStory } from './read.js';

function story(chapters: Record<string, string>, variables = '') {
  const files = [
    { path: 'story.md', title: 'Story', text: '---\ntitle: Gull Rock\ninteractive: true\n---\n' },
    { path: 'ink/variables.md', title: 'Variables', text: variables },
    ...Object.entries(chapters).map(([id, ink], index) => ({
      path: `chapters/${id}.md`,
      title: id,
      text: `---\ntitle: ${id}\nnumber: ${index + 1}\n---\n## Chapter Text\n\n${ink}\n`,
    })),
  ];
  const reading = readInkStory(files, 'Gull Rock');
  expect(reading.compiled.diagnostics.filter((entry) => entry.severity === 'error')).toEqual([]);
  return explorePaths(reading.compiled.json!, reading.structure!);
}

describe('exploring every path', () => {
  it('finds dead ends with the choices that reach them, never-offered choices, and unreached knots', () => {
    const report = story({
      'chapter-01': [
        'The lamp is dark.',
        '+ [Wait] -> chapter_01',
        '* [Climb] -> chapter_02',
        '* {false} [Fly] -> chapter_03',
        '* [Swim] -> chapter_03',
      ].join('\n'),
      'chapter-02': 'The stairs.\n-> END',
      'chapter-03': 'The water is cold.',
      'chapter-04': 'Nobody comes here.\n-> END',
    });
    expect(report.complete).toBe(true);
    expect(report.errors).toEqual([
      { message: expect.stringMatching(/ran out of content/u), path: [2] },
    ]);
    expect(report.neverOffered).toEqual([
      expect.objectContaining({ node: 'chapter_01', text: 'Fly', path: 'chapters/chapter-01.md' }),
    ]);
    expect(report.unreached.map((entry) => entry.node)).toEqual(['chapter_04']);
    expect(report.endings).toBeGreaterThan(0);
    expect(report.shortest).toBe(1);
  });

  it('follows state: a choice offered only once a variable is set is offered', () => {
    const report = story(
      {
        'chapter-01': [
          '+ {not lamp_lit} [Light the lamp]',
          '    ~ lamp_lit = true',
          '    -> chapter_01',
          '+ {lamp_lit} [Go down] -> chapter_02',
        ].join('\n'),
        'chapter-02': 'Down.\n-> END',
      },
      '---\ntitle: Variables\n---\nVAR lamp_lit = false\n',
    );
    expect(report).toMatchObject({ complete: true, errors: [], neverOffered: [], unreached: [] });
    expect(report.shortest).toBe(2);
  });

  it('tells visit counts apart up to the largest number the story compares them with', () => {
    const report = story({
      // Each Wait leaves the stitch and comes back, so its visit count rises.
      'chapter-01': [
        '-> desk',
        '= desk',
        '+ [Wait] -> pause',
        '* {desk > 4} [Leave] -> chapter_02',
        '= pause',
        '-> desk',
      ].join('\n'),
      'chapter-02': 'Out.\n-> END',
    });
    expect(report).toMatchObject({ complete: true, neverOffered: [], unreached: [] });
    expect(report.shortest).toBe(5);
  });

  it('tells apart choices with the same text in different stitches', () => {
    const report = story({
      'chapter-01': [
        '-> left',
        '= left',
        '* [Open the door] -> chapter_02',
        '= right',
        '* [Open the door] -> chapter_02',
      ].join('\n'),
      'chapter-02': 'Out.\n-> END',
    });
    expect(report.neverOffered).toEqual([
      expect.objectContaining({ node: 'chapter_01.right', text: 'Open the door' }),
    ]);
  });

  it('stops a passage that loops without offering a choice, and says it is partial', () => {
    const started = Date.now();
    const report = story({ 'chapter-01': '-> spin\n= spin\nRound.\n-> spin' });
    expect(report.complete).toBe(false);
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 20_000);

  it('stops at its budget on a story too large to explore, and says so', () => {
    const report = story(
      {
        'chapter-01': [
          '+ [Up]',
          '    ~ height += 1',
          '    -> chapter_01',
          '+ [Down]',
          '    ~ height -= 1',
          '    -> chapter_01',
          '+ [Stop] -> END',
        ].join('\n'),
      },
      '---\ntitle: Variables\n---\nVAR height = 0\n',
    );
    expect(report.complete).toBe(false);
    expect(report.explored).toBeGreaterThan(100);
  }, 20_000);
});
