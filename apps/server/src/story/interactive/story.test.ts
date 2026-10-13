import { Story } from 'inkjs/full';
import { describe, expect, it } from 'vitest';

import { assembleStory, type InkChapterFile } from './assemble.js';
import { compileStory } from './compile.js';
import { storyStructure } from './structure.js';

function chapter(id: string, number: number, body: string, title = id): InkChapterFile {
  return {
    id,
    title,
    number,
    path: `chapters/${id}.md`,
    text: `---\ntitle: ${title}\nnumber: ${number}\n---\n${body}`,
  };
}

const variables = {
  path: 'ink/variables.md',
  text: '---\ntitle: Variables\n---\nVAR trust = 0\nLIST mood = calm, angry\n',
};

function build(chapters: InkChapterFile[], inkFiles = [variables]) {
  const story = assembleStory({
    title: 'Gull Rock',
    author: 'M. Vale',
    ifid: null,
    chapters,
    inkFiles,
  });
  const compiled = compileStory(story);
  return { story, compiled };
}

describe('assembling and compiling an ink book', () => {
  it('plays chapters as knots, starting with the first in order', () => {
    const { story, compiled } = build([
      chapter('chapter-02', 2, 'The steps are slick.\n-> END\n', 'Down'),
      chapter('chapter-01', 1, 'Waves break.\n-> chapter_02\n', 'Harbor'),
    ]);
    expect(story.chapters.map((entry) => entry.knot)).toEqual(['chapter_01', 'chapter_02']);
    expect(compiled.diagnostics).toEqual([]);
    const ink = new Story(compiled.json!);
    expect(ink.ContinueMaximally()).toBe('Waves break.\nThe steps are slick.\n');
    expect(ink.globalTags).toEqual(['title: Gull Rock', 'author: M. Vale']);
  });

  it('reports errors at the chapter file and line', () => {
    const { compiled } = build([chapter('chapter-01', 1, 'Fine.\nOops {bad\n-> END\n')]);
    expect(compiled.json).toBeNull();
    expect(compiled.diagnostics[0]).toMatchObject({
      severity: 'error',
      path: 'chapters/chapter-01.md',
      line: 6,
    });
  });

  it('reports an error when inkjs throws before it has a parse tree', () => {
    // `<-` parses as `< -true`, and inkjs throws on negating a boolean
    // instead of reporting it.
    const { compiled } = build([chapter('chapter-01', 1, '~ trust <- true\n-> END\n')]);
    expect(compiled.json).toBeNull();
    expect(compiled.parsed).toBeNull();
    expect(compiled.diagnostics).toEqual([
      { severity: 'error', message: 'Unexpected operation or number type', path: null, line: null },
    ]);
  });

  it('reads choices, conditions, writes, stitches, and reachability', () => {
    const { story, compiled } = build([
      chapter(
        'chapter-01',
        1,
        [
          'Hello {trust > 1: friend|stranger}.',
          '* {trust > 0} [Smile] You smile.',
          '  ~ trust += 1',
          '* [Leave] -> chapter_02',
          '+ Stay',
          '- They talk.',
          '-> cellar',
          '= cellar',
          'Dark. -> chapter_02',
        ].join('\n'),
        'Harbor',
      ),
      chapter('chapter-02', 2, 'The end.\n-> END\n'),
      chapter('chapter-03', 3, 'Nobody comes here.\n-> END\n'),
    ]);
    expect(compiled.diagnostics).toEqual([]);
    const structure = storyStructure(compiled.parsed!, story);
    expect(structure.start).toBe('chapter_01');
    const first = structure.nodes.find((node) => node.name === 'chapter_01')!;
    expect(first).toMatchObject({ kind: 'chapter', chapterId: 'chapter-01', title: 'Harbor' });
    expect(first.choices).toEqual([
      {
        text: 'Smile',
        once: true,
        condition: 'trust > 0',
        target: null,
        writes: ['trust'],
        line: 6,
      },
      { text: 'Leave', once: true, condition: null, target: 'chapter_02', writes: [], line: 8 },
      { text: 'Stay', once: false, condition: null, target: null, writes: [], line: 9 },
    ]);
    expect(first.diverts).toEqual([{ target: 'chapter_01.cellar', kind: 'divert', line: 11 }]);
    expect(first.reads).toEqual(['trust']);
    expect(first.writes).toEqual(['trust']);
    const cellar = structure.nodes.find((node) => node.name === 'chapter_01.cellar')!;
    expect(cellar).toMatchObject({
      kind: 'stitch',
      chapterId: 'chapter-01',
      reachable: true,
      line: 12,
    });
    expect(structure.nodes.find((node) => node.name === 'chapter_03')!.reachable).toBe(false);
    expect(structure.nodes.find((node) => node.name === 'chapter_02')!.ends).toBe(true);
    expect(structure.variables).toEqual([
      { name: 'trust', kind: 'var', initial: '0', path: 'ink/variables.md', line: 4 },
      { name: 'mood', kind: 'list', initial: 'calm, angry', path: 'ink/variables.md', line: 5 },
    ]);
  });

  it('lets an ink file set the start, and writes one file for Inky', () => {
    const { story, compiled } = build(
      [chapter('chapter-01', 1, 'One.\n-> END\n'), chapter('chapter-02', 2, 'Two.\n-> END\n')],
      [
        {
          path: 'ink/start.md',
          text: 'VAR seen = false\n-> chapter_02\n=== helper ===\nHelp.\n->->\n',
        },
      ],
    );
    expect(compiled.diagnostics).toEqual([]);
    // An ink file that sets the start can leave an empty first line, which players skip.
    expect(new Story(compiled.json!).ContinueMaximally().trim()).toBe('Two.');
    expect(storyStructure(compiled.parsed!, story).start).toBe('chapter_02');
    const single = compileStory(
      assembleStory({ title: 'x', author: '', ifid: null, chapters: [], inkFiles: [] }),
    );
    expect(single.diagnostics).toEqual([]);
    expect(story.combined).toContain('VAR seen = false\n-> chapter_02');
    expect(
      new Story(
        compileStory({ ...story, files: { ...story.files, [story.root]: story.combined } }).json!,
      )
        .ContinueMaximally()
        .trim(),
    ).toBe('Two.');
    expect(story.combined.indexOf('=== helper ===')).toBeGreaterThan(
      story.combined.indexOf('-> chapter_02'),
    );
  });
});
