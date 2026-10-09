import matter from 'gray-matter';
import { describe, expect, it } from 'vitest';

import { parseTwee } from './book-play.js';
import { branchGraph, setFrontmatterChoices, type ChapterSource } from './branches.js';

const HASH = 'a'.repeat(64);

function chapter(id: string, number: number, choices?: unknown): ChapterSource {
  return {
    id,
    title: id,
    path: `chapters/${id}.md`,
    hash: HASH,
    frontmatter: choices === undefined ? { number } : { number, choices },
  };
}

describe('branchGraph', () => {
  it('runs a book without choices in order, with no endings', () => {
    const graph = branchGraph([chapter('chapter-02', 2), chapter('chapter-01', 1)], null);
    expect(graph.branching).toBe(false);
    expect(
      graph.chapters.map((entry) => [entry.id, entry.start, entry.ending, entry.reachable]),
    ).toEqual([
      ['chapter-01', true, false, true],
      ['chapter-02', false, false, true],
    ]);
  });

  it('marks endings, unreachable chapters, and malformed choices once any chapter branches', () => {
    const graph = branchGraph(
      [
        chapter('chapter-01', 1, [
          { text: 'Follow the light', to: 'chapter-02' },
          { text: 'Ghost', to: 'chapter-99' },
          { text: 'Bad [link]', to: 'chapter-03' },
          { to: 'chapter-03' },
        ]),
        chapter('chapter-02', 2),
        chapter('chapter-03', 3),
      ],
      'IFID',
    );
    expect(graph.branching).toBe(true);
    expect(graph.ifid).toBe('IFID');
    const [first, second, third] = graph.chapters;
    expect(first?.choices).toEqual([
      { text: 'Follow the light', to: 'chapter-02' },
      { text: 'Ghost', to: 'chapter-99' },
    ]);
    expect(first?.problems).toEqual([
      'Choice 3 text cannot contain [, ], |, ->, <-, or a line break, or end in <',
      'Choice 4 needs text: the words the reader picks',
    ]);
    expect(second).toMatchObject({ ending: true, reachable: true });
    expect(third).toMatchObject({ ending: true, reachable: false });
  });

  it('reports a choices field that is not a list', () => {
    const graph = branchGraph([chapter('chapter-01', 1, 'chapter-02')], null);
    expect(graph.chapters[0]?.problems).toEqual(['choices must be a list of { text, to } entries']);
  });
});

describe('setFrontmatterChoices', () => {
  const file = [
    '---',
    'type: chapter',
    '# keep this comment',
    'title: Harbor Wall',
    'choices:',
    '  - text: Old',
    '    to: chapter-09',
    '',
    'number: 1',
    'status: draft',
    '---',
    '',
    '# Harbor Wall',
    '',
    'Prose.',
    '',
  ].join('\n');

  it('replaces only the choices block', () => {
    const result = setFrontmatterChoices(file, [
      { text: 'Follow "the" light', to: 'chapter-02' },
      { text: '42', to: 'chapter-03' },
    ]);
    expect(result).toBe(
      file.replace(
        'choices:\n  - text: Old\n    to: chapter-09\n',
        'choices:\n  - text: "Follow \\"the\\" light"\n    to: chapter-02\n  - text: "42"\n    to: chapter-03\n',
      ),
    );
    expect(matter(result).data.choices).toEqual([
      { text: 'Follow "the" light', to: 'chapter-02' },
      { text: '42', to: 'chapter-03' },
    ]);
  });

  it('removes the field for an empty list and adds it where there was none', () => {
    const removed = setFrontmatterChoices(file, []);
    expect(removed).not.toContain('choices');
    expect(removed).toContain('# keep this comment');
    expect(matter(removed).data).toMatchObject({ number: 1, status: 'draft' });

    const added = setFrontmatterChoices(removed, [{ text: 'Go on', to: 'chapter-02' }]);
    expect(matter(added).data.choices).toEqual([{ text: 'Go on', to: 'chapter-02' }]);
    expect(added.endsWith('# Harbor Wall\n\nProse.\n')).toBe(true);
  });

  it('handles a non-indented list and a flow list', () => {
    const block = '---\nchoices:\n- text: A\n  to: chapter-02\nnumber: 1\n---\nBody\n';
    expect(setFrontmatterChoices(block, [])).toBe('---\nnumber: 1\n---\nBody\n');
    const flow = '---\nchoices: [{text: A, to: chapter-02}]\nnumber: 1\n---\nBody\n';
    expect(matter(setFrontmatterChoices(flow, [{ text: 'B', to: 'chapter-03' }])).data).toEqual({
      choices: [{ text: 'B', to: 'chapter-03' }],
      number: 1,
    });
  });

  it('adds frontmatter to a file without any, and leaves it alone when there is nothing to add', () => {
    expect(setFrontmatterChoices('Prose.\n', [])).toBe('Prose.\n');
    expect(setFrontmatterChoices('Prose.\n', [{ text: 'Go', to: 'chapter-02' }])).toBe(
      '---\nchoices:\n  - text: "Go"\n    to: chapter-02\n---\nProse.\n',
    );
  });

  it('refuses frontmatter it cannot read rather than rewrite it', () => {
    expect(() => setFrontmatterChoices('---\ntitle: [unclosed\n---\nProse\n', [])).toThrow(
      /could not be read/u,
    );
  });
});

describe('parseTwee', () => {
  it('reads the title, IFID, start, prose, and links as tweeSource writes them', () => {
    const twee = [
      ':: StoryTitle',
      'The Gull Rock Light',
      '',
      ':: StoryData',
      '{\n  "ifid": "649C4AC9-78FE-4B32-B821-24D0802D1DD9",\n  "start": "chapter-01"\n}',
      '',
      ':: chapter-01',
      'The tower door stands open.',
      '\\:: not a passage',
      '',
      '[[Search the rocks->chapter-02]]',
      '[[Climb the tower->chapter-03]]',
      '',
      ':: chapter-02',
      'The end.',
      '',
    ].join('\n');
    expect(parseTwee(twee)).toEqual({
      title: 'The Gull Rock Light',
      ifid: '649C4AC9-78FE-4B32-B821-24D0802D1DD9',
      start: 'chapter-01',
      passages: [
        {
          id: 'chapter-01',
          prose: 'The tower door stands open.\n:: not a passage',
          links: [
            { text: 'Search the rocks', to: 'chapter-02' },
            { text: 'Climb the tower', to: 'chapter-03' },
          ],
        },
        { id: 'chapter-02', prose: 'The end.', links: [] },
      ],
    });
  });
});
