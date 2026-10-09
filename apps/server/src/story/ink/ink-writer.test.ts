import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Compiler, CompilerOptions, Story } from 'inkjs/full';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  flagProblem,
  inkKnotName,
  inkSource,
  storyFlags,
  type InkPassage,
  type InkStory,
} from './ink-writer.js';
import {
  fencedLineIndexes,
  isHeadingLine,
  separateSceneBreaks,
  softBreak,
} from './story-skills-markdown.js';

interface UpstreamInk {
  inkKnotName: (id: string) => string;
  inkSource: (story: {
    title: string;
    author: string;
    ifid: string;
    branching: boolean;
    passages: { name: string; body: string; links: { text: string; to: string }[] }[];
  }) => string;
}

interface UpstreamMarkdown {
  separateSceneBreaks: (text: string) => string;
  softBreak: (before: string, after: string) => string;
  isHeadingLine: (line: string) => boolean;
  fencedLineIndexes: (lines: string[]) => Set<number>;
}

let upstreamInk: UpstreamInk;
let upstreamMarkdown: UpstreamMarkdown;

beforeAll(async () => {
  const root = dirname(createRequire(import.meta.url).resolve('story-skills/package.json'));
  const load = async <T>(file: string) =>
    (await import(pathToFileURL(join(root, 'src', file)).href)) as T;
  upstreamInk = await load<UpstreamInk>('ink.js');
  upstreamMarkdown = await load<UpstreamMarkdown>('markdown.js');
});

const IFID = '649C4AC9-78FE-4B32-B821-24D0802D1DD9';

function compile(source: string): Story {
  const errors: string[] = [];
  const story = new Compiler(
    source,
    new CompilerOptions(null, [], true, (message: string, type: number) => {
      if (type === 2) errors.push(message);
    }),
  ).Compile();
  expect(errors).toEqual([]);
  return new Story(story.ToJson()!);
}

/** Every passage's text and choices on every path, choosing each choice once. */
function walk(source: string, maxSteps = 12): string[] {
  const transcripts: string[] = [];
  const visit = (path: number[]) => {
    const story = compile(source);
    let text = story.ContinueMaximally();
    for (const index of path) {
      story.ChooseChoiceIndex(index);
      text += `> ${index}\n${story.ContinueMaximally()}`;
    }
    const choices = story.currentChoices.map((choice: { text: string }) => choice.text);
    transcripts.push(`${text}[${choices.join(' | ')}]`);
    if (path.length < maxSteps)
      choices.forEach((_: string, index: number) => visit([...path, index]));
  };
  visit([]);
  return transcripts;
}

function passage(id: string, body: string, choices: InkPassage['choices'] = []): InkPassage {
  return { id, title: `Title of ${id}`, body, choices };
}

function story(passages: InkPassage[], branching = true): InkStory {
  return { title: 'The Gull Rock Light', author: 'A. Writer', ifid: IFID, branching, passages };
}

/** The same story as story-skills' ink build reads it. */
function upstreamSource(input: InkStory): string {
  return upstreamInk.inkSource({
    title: input.title,
    author: input.author,
    ifid: input.ifid,
    branching: input.branching,
    passages: input.passages.map((entry) => ({
      name: entry.id,
      body: entry.body,
      links: entry.choices.map(({ text, to }) => ({ text, to })),
    })),
  });
}

/** Prose with no headings, lists, quotations, tables, or code: both writers must agree. */
const PLAIN_BODIES = [
  'One paragraph.',
  'First line\nsecond line of the same paragraph.\n\nA new paragraph.',
  'Verse one  \nverse two\\\nverse three\nstill three',
  'Before.\n\n***\n\nAfter.\n* * *\nAgain.\n---\nEnd.\n\n#\n\nLast.',
  '漢字の\n文です\n\nそして、\n「次」',
  'Escapes: {curly} | # [x] ~ -> <- <> // /* \\ end',
  '* not a list\nbut a line that starts with a star',
  'VAR x = 1\nTODO: nothing\nINCLUDE file.ink',
  '"Quoted," she said -- dash --- dash … ellipsis',
  'Trailing backslash\\',
  'A line with  double  spaces inside.',
  'CRLF one\r\ntwo\r\n\r\nthree',
];

describe('vendored story-skills markdown helpers', () => {
  const samples = [
    ...PLAIN_BODIES,
    '```\n---\n```\n---',
    '````\nx\n```\n````',
    '   ***\n    ***',
    '\\* \\* \\*',
    '* * *',
    '## Heading\n#hashtag\n#',
  ];

  it('separate scene breaks and find code fences as the pinned package does', () => {
    for (const sample of samples) {
      expect(separateSceneBreaks(sample)).toBe(upstreamMarkdown.separateSceneBreaks(sample));
      const lines = sample.split('\n');
      expect([...fencedLineIndexes(lines)]).toEqual([...upstreamMarkdown.fencedLineIndexes(lines)]);
      for (const line of lines) {
        expect(isHeadingLine(line)).toBe(upstreamMarkdown.isHeadingLine(line));
      }
    }
  });

  it('join soft breaks as the pinned package does', () => {
    const pairs = [
      ['漢字', '文'],
      ['漢字', 'word'],
      ['word', '文'],
      ['漢字', '“'],
      ['”', '文'],
      ['葛\u{e0100}', '文'],
      ['end', 'start'],
      ['', ''],
    ] as const;
    for (const [before, after] of pairs) {
      expect(softBreak(before, after)).toBe(upstreamMarkdown.softBreak(before, after));
    }
  });
});

describe('ink writer', () => {
  it('names knots exactly as the pinned story-skills ink build does', () => {
    for (const id of ['chapter-01', '01', '1st-light', 'true', 'function', 'prologue']) {
      expect(inkKnotName(id)).toBe(upstreamInk.inkKnotName(id));
    }
  });

  it('plays plain prose exactly as story-skills ink does, on every path', () => {
    for (const body of PLAIN_BODIES) {
      const single = story([passage('chapter-01', body)]);
      expect(walk(inkSource(single))).toEqual(walk(upstreamSource(single)));
    }
    const branching = story([
      passage('chapter-01', 'The tower door stands open.', [
        { text: 'Search the rocks', to: 'chapter-02', sets: [], requires: [] },
        { text: 'Climb the {tower}', to: 'chapter-03', sets: [], requires: [] },
      ]),
      passage('chapter-02', 'An oilskin coat.', [
        { text: 'Go up', to: 'chapter-03', sets: [], requires: [] },
      ]),
      passage('chapter-03', 'The lamp is dark.'),
      passage('chapter-04', ''),
    ]);
    const paths = walk(inkSource(branching));
    expect(paths.length).toBeGreaterThan(3);
    expect(paths).toEqual(walk(upstreamSource(branching)));
    const linear = story([passage('chapter-01', 'One.'), passage('chapter-02', 'Two.')], false);
    expect(walk(inkSource(linear))).toEqual(walk(upstreamSource(linear)));
  });

  it('keeps headings, list items, quotations, tables, and code on their own lines', () => {
    const body = [
      'The tide turns.',
      '## Later',
      'Night falls.',
      '- one',
      '- two',
      '  continued',
      '1. first',
      '> quoted',
      '> still quoted',
      '| a | b |',
      '| 1 | 2 |',
      '```',
      'VAR x = {1}',
      '```',
      'After the code.',
    ].join('\n');
    expect(compile(inkSource(story([passage('chapter-01', body)]))).ContinueMaximally()).toBe(
      [
        'The tide turns.',
        '## Later',
        'Night falls.',
        '- one',
        '- two continued',
        '1. first',
        '> quoted still quoted',
        '| a | b |',
        '| 1 | 2 |',
        '```',
        'VAR x = {1}',
        '```',
        'After the code.',
        '',
      ].join('\n'),
    );
    // story-skills 0.23.0's ink build runs them into the paragraphs around them.
    const upstream = compile(
      upstreamSource(story([passage('chapter-01', body)])),
    ).ContinueMaximally();
    expect(upstream).toContain('The tide turns. ## Later Night falls.');
  });

  it('tags each knot with its chapter title, and the story with title, author, and IFID', () => {
    const source = inkSource(story([passage('chapter-01', 'Text.'), passage('chapter-02', '')]));
    const played = compile(source);
    expect(played.globalTags).toEqual([
      'title: The Gull Rock Light',
      'author: A. Writer',
      `ifid: ${IFID}`,
    ]);
    expect(played.TagsForContentAtPath('chapter_02')).toEqual(['chapter: Title of chapter-02']);
    played.ContinueMaximally();
    expect(played.TagsForContentAtPath('chapter_01')).toEqual(['chapter: Title of chapter-01']);
  });

  it('sets flags on choices and offers choices only when their conditions hold', () => {
    const source = inkSource(
      story([
        passage('chapter-01', 'The lamp is dark.', [
          {
            text: 'Light the lamp',
            to: 'chapter-01',
            sets: ['lamp_lit'],
            requires: ['not lamp_lit'],
          },
          { text: 'Ring the bell', to: 'chapter-02', sets: [], requires: ['lamp_lit'] },
          { text: 'Read the log', to: 'chapter-03', sets: [], requires: ['not chapter-03'] },
        ]),
        passage('chapter-02', 'The ship turns away.'),
        passage('chapter-03', 'The log is empty.', [
          { text: 'Back', to: 'chapter-01', sets: ['not lamp_lit'], requires: [] },
        ]),
      ]),
    );
    expect(source).toContain('VAR lamp_lit = false');
    expect(source).toContain(
      '+ {not lamp_lit} [Light the lamp]\n    ~ lamp_lit = true\n    -> chapter_01',
    );
    expect(source).toContain('+ {not chapter_03} [Read the log] -> chapter_03');

    const played = compile(source);
    played.ContinueMaximally();
    expect(played.currentChoices.map((choice: { text: string }) => choice.text)).toEqual([
      'Light the lamp',
      'Read the log',
    ]);
    played.ChooseChoiceIndex(0);
    played.ContinueMaximally();
    expect(played.variablesState.$('lamp_lit')).toBe(true);
    expect(played.currentChoices.map((choice: { text: string }) => choice.text)).toEqual([
      'Ring the bell',
      'Read the log',
    ]);
    played.ChooseChoiceIndex(1);
    played.ContinueMaximally();
    played.ChooseChoiceIndex(0);
    played.ContinueMaximally();
    // Reading the log once hides it, and coming back unset the lamp.
    expect(played.variablesState.$('lamp_lit')).toBe(false);
    expect(played.currentChoices.map((choice: { text: string }) => choice.text)).toEqual([
      'Light the lamp',
    ]);
  });

  it('declares only flags, never chapters a choice tests', () => {
    expect(
      storyFlags(
        story([
          passage('chapter-01', 'x', [
            {
              text: 'Go',
              to: 'chapter-02',
              sets: ['found_coat'],
              requires: ['chapter-02', 'not met_venn'],
            },
          ]),
          passage('chapter-02', 'y'),
        ]),
      ),
    ).toEqual(['met_venn', 'found_coat']);
  });

  it('refuses flag names ink cannot use', () => {
    const knots = new Set(['chapter_01']);
    expect(flagProblem('found_coat', knots)).toBeNull();
    expect(flagProblem('chapter_01', knots)).toMatch(/knot name/u);
    expect(flagProblem('and', knots)).toMatch(/reserves/u);
    expect(flagProblem('not', knots)).toMatch(/reserves/u);
    expect(flagProblem('1st', knots)).toMatch(/not a flag name/u);
    expect(flagProblem('has space', knots)).toMatch(/not a flag name/u);
  });

  it('prints any prose and choice text as written', () => {
    const lines = [
      'Plain {curly} and | pipe and # hash and [brackets] and ~tilde',
      'Arrow -> here and <- there and <> glue and --> long',
      'Comment // here and /* block */ and url http://x.com/a//b',
      '+ plus',
      '= equals',
      '=== triple',
      'CONST y = 2',
      'EXTERNAL f()',
      'LIST l = a',
      '<<set $x to 1>> and (set: $y to 2)',
      'END',
      'DONE',
      '{',
      '}',
    ];
    for (const line of lines) {
      const source = inkSource(
        story([
          passage('chapter-01', line, [{ text: line, to: 'chapter-01', sets: [], requires: [] }]),
        ]),
      );
      const played = compile(source);
      expect(played.ContinueMaximally().trim()).toBe(line);
      expect(played.currentChoices[0]?.text).toBe(line);
    }
  });
});
