import type { BookBranches, BranchChapter } from '@worldbookllm/shared';
import { describe, expect, it } from 'vitest';

import { layoutBranchMap } from './branch-map-layout.js';

function chapter(id: string, change: Partial<BranchChapter> = {}): BranchChapter {
  return {
    id,
    title: id,
    path: `chapters/${id}.md`,
    hash: 'a'.repeat(64),
    choices: [],
    problems: [],
    start: id === 'chapter-01',
    ending: false,
    reachable: true,
    ...change,
  };
}

const go = (to: string, text = 'Go', sets: string[] = []) => ({ text, to, sets, requires: [] });

function graph(chapters: BranchChapter[], branching = true): BookBranches {
  return { branching, ifid: null, invalidIfid: null, flags: [], chapters };
}

describe('layoutBranchMap', () => {
  it('rows chapters by choices from the start, with what no path reaches last', () => {
    const layout = layoutBranchMap(
      graph([
        chapter('chapter-01', { choices: [go('chapter-02'), go('chapter-03', 'Climb', ['lamp'])] }),
        chapter('chapter-02', { choices: [go('chapter-04'), go('chapter-01', 'Back')] }),
        chapter('chapter-03', { choices: [go('chapter-04'), go('chapter-03', 'Wait')] }),
        chapter('chapter-04', { ending: true }),
        chapter('chapter-05', { reachable: false, ending: true }),
      ]),
    );
    const row = (id: string) => layout.nodes.find((node) => node.chapter.id === id)!;
    expect(
      ['chapter-01', 'chapter-02', 'chapter-03', 'chapter-04', 'chapter-05'].map(
        (id) => row(id).depth,
      ),
    ).toEqual([0, 1, 1, 2, null]);
    expect(row('chapter-02').y).toBe(row('chapter-03').y);
    expect(row('chapter-02').x).toBeLessThan(row('chapter-03').x);
    expect(row('chapter-05').y).toBeGreaterThan(row('chapter-04').y);

    const edge = (from: string, to: string) =>
      layout.edges.find((entry) => entry.from === from && entry.to === to)!;
    expect(edge('chapter-01', 'chapter-02')).toMatchObject({ back: false, stateful: false });
    expect(edge('chapter-01', 'chapter-03')).toMatchObject({ back: false, stateful: true });
    expect(edge('chapter-02', 'chapter-01').back).toBe(true);
    expect(edge('chapter-03', 'chapter-03').back).toBe(true);
    expect(layout.height).toBeGreaterThan(row('chapter-05').y);
  });

  it('chains a linear book in chapter order, and leaves out choices to missing chapters', () => {
    const linear = layoutBranchMap(graph([chapter('chapter-01'), chapter('chapter-02')], false));
    expect(linear.edges).toEqual([
      { from: 'chapter-01', to: 'chapter-02', text: null, back: false, stateful: false },
    ]);
    const missing = layoutBranchMap(
      graph([chapter('chapter-01', { choices: [go('chapter-09')] })]),
    );
    expect(missing.edges).toEqual([]);
  });
});
