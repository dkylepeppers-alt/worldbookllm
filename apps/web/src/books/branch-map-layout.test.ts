import type { InteractiveStory, StoryNode } from '@worldbookllm/shared';
import { describe, expect, it } from 'vitest';

import { layoutBranchMap, mapPlaces } from './branch-map-layout.js';

function node(name: string, change: Partial<StoryNode> = {}): StoryNode {
  const knot = name.split('.')[0]!;
  return {
    name,
    kind: name.includes('.') ? 'stitch' : 'chapter',
    chapterId: knot.replace('_', '-'),
    title: knot,
    path: `chapters/${knot.replace('_', '-')}.md`,
    line: null,
    choices: [],
    diverts: [],
    ends: false,
    reads: [],
    writes: [],
    words: 1,
    reachable: true,
    ...change,
  };
}

const go = (target: string, text = 'Go', condition: string | null = null) => ({
  text,
  once: false,
  condition,
  target,
  writes: [],
  line: null,
});

function story(nodes: StoryNode[]): InteractiveStory {
  const chapters = nodes
    .filter((entry) => entry.kind === 'chapter')
    .map((entry) => ({
      id: entry.chapterId!,
      title: entry.title,
      path: entry.path!,
      hash: 'a'.repeat(64),
      knot: entry.name,
    }));
  return {
    title: 'Story',
    ifid: null,
    chapters,
    compiled: true,
    start: chapters[0]?.knot ?? null,
    nodes,
    variables: [],
    diagnostics: [],
  };
}

describe('layoutBranchMap', () => {
  it('rows knots by steps from the start, folds stitches in, and puts what nothing reaches last', () => {
    const layout = layoutBranchMap(
      story([
        node('chapter_01', { choices: [go('chapter_02'), go('chapter_03', 'Climb', 'lamp')] }),
        node('chapter_02', {
          choices: [go('chapter_04'), go('chapter_01', 'Back')],
          diverts: [{ target: 'chapter_02.ledge', kind: 'divert', line: null }],
        }),
        node('chapter_02.ledge', {
          diverts: [{ target: 'chapter_04', kind: 'tunnel', line: null }],
        }),
        node('chapter_03', { choices: [go('chapter_03', 'Wait')] }),
        node('chapter_04', { ends: true }),
        node('chapter_05', { reachable: false, ends: true }),
      ]),
    );
    const row = (name: string) => layout.nodes.find((entry) => entry.place.name === name)!;
    expect(
      ['chapter_01', 'chapter_02', 'chapter_03', 'chapter_04', 'chapter_05'].map(
        (name) => row(name).depth,
      ),
    ).toEqual([0, 1, 1, 2, null]);
    expect(row('chapter_02').place.stitches).toEqual(['ledge']);
    // A move into its own stitch stays inside the box; the stitch's tunnel leaves from the box.
    expect(layout.edges.filter((edge) => edge.from === 'chapter_02')).toMatchObject([
      { to: 'chapter_04', kind: 'choice', back: false },
      { to: 'chapter_01', kind: 'choice', back: true },
      { to: 'chapter_04', kind: 'tunnel', text: null },
    ]);
    expect(layout.edges.find((edge) => edge.text === 'Climb')).toMatchObject({
      stateful: true,
      condition: 'lamp',
    });
    expect(row('chapter_05').y).toBeGreaterThan(row('chapter_04').y);
  });

  it('wraps a row wider than six boxes', () => {
    const nodes = Array.from({ length: 9 }, (_, index) =>
      node(`chapter_${String(index + 1).padStart(2, '0')}`, { reachable: index === 0 }),
    );
    const layout = layoutBranchMap(story(nodes));
    const rows = new Set(layout.nodes.map((entry) => entry.y));
    expect(rows.size).toBe(3);
    expect(layout.width).toBeLessThan(6 * 200);
  });

  it('marks where the story starts and which knots can end it', () => {
    const places = mapPlaces(
      story([
        node('chapter_01', { diverts: [{ target: 'chapter_01.end', kind: 'divert', line: null }] }),
        node('chapter_01.end', { ends: true }),
      ]),
    );
    expect(places).toMatchObject([{ name: 'chapter_01', start: true, ends: true }]);
  });
});
