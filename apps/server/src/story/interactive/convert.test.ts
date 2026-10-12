import { Story } from 'inkjs/full';
import { describe, expect, it } from 'vitest';

import { parseFrontmatter } from '../book-index.js';
import { assembleStory } from './assemble.js';
import { compileStory } from './compile.js';
import { convertToInk, type ConvertedFile } from './convert.js';

const STORY = '---\ntitle: Gull Rock\nauthor: M. Vale\n---\n\n# Gull Rock\n';

function chapter(id: string, number: number, frontmatter: string, body: string) {
  return {
    id,
    number,
    path: `chapters/${id}.md`,
    text: `---\ntitle: ${id}\nnumber: ${number}\n${frontmatter}---\n${body}`,
  };
}

function play(files: ConvertedFile[]): Story {
  const chapters = files
    .filter((file) => file.path.startsWith('chapters/'))
    .map((file) => {
      const frontmatter = parseFrontmatter(file.after).frontmatter!;
      return {
        id: file.path.slice('chapters/'.length, -'.md'.length),
        title: String(frontmatter.title),
        number: frontmatter.number,
        path: file.path,
        text: file.after,
      };
    });
  const inkFiles = files
    .filter((file) => file.path.startsWith('ink/'))
    .map((file) => ({ path: file.path, text: file.after }));
  const compiled = compileStory(
    assembleStory({ title: 'Gull Rock', author: '', ifid: null, chapters, inkFiles }),
  );
  expect(compiled.diagnostics).toEqual([]);
  return new Story(compiled.json!);
}

const text = (story: Story) => story.ContinueMaximally().trim();
const choices = (story: Story) =>
  story.currentChoices.map((choice: { text: string }) => choice.text);

describe('converting a book to ink chapters', () => {
  it('turns frontmatter choices, sets, and requires into ink that plays the same', () => {
    const files = convertToInk({
      story: STORY,
      variables: null,
      chapters: [
        chapter(
          'chapter-01',
          1,
          [
            'choices:',
            '  - text: "Light the [lamp]"',
            '    to: chapter-01',
            '    sets: ["lamp_lit"]',
            '    requires: ["not lamp_lit"]',
            '  - text: Go down',
            '    to: chapter-02',
            '    requires: ["lamp_lit"]',
            '  - text: Read the archive',
            '    to: chapter-03',
            '    requires: ["not chapter-03"]',
            '',
          ].join('\n'),
          '# The Wall\n\nThe lamp is *dark* {here}.\n\n* * *\n\n- a list item\n',
        ),
        chapter('chapter-02', 2, '', 'The steps are slick.\n'),
        chapter('chapter-03', 3, '', 'Venn is awake.\n'),
      ],
    });
    const first = files.find((file) => file.path === 'chapters/chapter-01.md')!.after;
    expect(first).not.toContain('choices:');
    expect(first).toContain('title: chapter-01\nnumber: 1\n---\n');
    // One leading heading is the chapter's title, which story-skills leaves out of its prose.
    expect(first).toContain(
      '# The Wall\n\n## Chapter Text\n\nThe lamp is *dark* \\{here\\}.\n\n# break\n\n\\- a list item\n\n',
    );
    expect(files.find((file) => file.path === 'ink/variables.md')!.after).toContain(
      'VAR lamp_lit = false',
    );
    const story = files.find((file) => file.path === 'story.md')!.after;
    expect(parseFrontmatter(story).frontmatter).toMatchObject({
      interactive: true,
      title: 'Gull Rock',
    });
    expect(String(parseFrontmatter(story).frontmatter!.ifid)).toMatch(/^[0-9A-F-]{36}$/u);

    const ink = play(files);
    expect(text(ink)).toContain('The lamp is *dark* {here}.');
    expect(choices(ink)).toEqual(['Light the [lamp]', 'Read the archive']);
    ink.ChooseChoiceIndex(0);
    text(ink);
    expect(choices(ink)).toEqual(['Go down', 'Read the archive']);
    ink.ChooseChoiceIndex(1);
    expect(text(ink)).toBe('Venn is awake.');
    expect(ink.currentChoices).toEqual([]);
  });

  it('runs a book without choices chapter to chapter, and keeps an IFID it has', () => {
    const ifid = '649C4AC9-78FE-4B32-B821-24D0802D1DD9';
    const files = convertToInk({
      story: `---\ntitle: Gull Rock\nifid: ${ifid}\n---\n`,
      variables: '---\ntitle: Story variables\n---\nVAR seen = false\n',
      chapters: [chapter('chapter-02', 2, '', 'Two.\n'), chapter('chapter-01', 1, '', 'One.\n')],
    });
    expect(files.map((file) => file.path)).toEqual([
      'chapters/chapter-01.md',
      'chapters/chapter-02.md',
      'story.md',
    ]);
    expect(parseFrontmatter(files.at(-1)!.after).frontmatter!.ifid).toBe(ifid);
    expect(text(play(files))).toBe('One.\nTwo.');
  });

  it("keeps a chapter's outline as Markdown above its ink, and its comments as ink comments", () => {
    const body = [
      '# Chapter 1: Harbor Wall',
      '',
      '## Outline',
      '',
      '1. Opening beat',
      '',
      '---',
      '',
      '## Chapter Text',
      '',
      'Mara climbs. <!-- check the tide tables -->',
      '',
      'She waits.',
      '',
    ].join('\n');
    const files = convertToInk({
      story: STORY,
      variables: null,
      chapters: [chapter('chapter-01', 1, '', body)],
    });
    const after = files[0]!.after;
    expect(after).toContain(
      '## Outline\n\n1. Opening beat\n\n---\n\n## Chapter Text\n\nMara climbs.\n\n/* check the tide tables */\n\nShe waits.\n\n-> END\n',
    );
    expect(text(play(files))).toBe('Mara climbs.\nShe waits.');
  });
});
