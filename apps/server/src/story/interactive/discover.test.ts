import { describe, expect, it } from 'vitest';

import { parseFrontmatter } from '../book-index.js';
import {
  DEFAULT_CHOICE_RULES,
  beatFiles,
  discoverBeats,
  inkHash,
  leadFrontier,
  looseVariable,
  markReviewed,
  nextChapterNumber,
  readKernel,
  readRules,
  readSetup,
  readVariables,
  rulesFile,
  seedChapter,
  setupFile,
  withAddedChoice,
  withKernel,
  withSeedNote,
  withVariables,
  type BeatProposal,
  type DiscoverChapter,
} from './discover.js';
import { inkSection } from './format.js';
import { readInkStory } from './read.js';
import { replayPosition, transcriptText } from './replay.js';

const STORY = '---\ntitle: The Lighthouse\ninteractive: true\n---\n\n# The Lighthouse\n';

function chapterOf(path: string, text: string): DiscoverChapter {
  const frontmatter = parseFrontmatter(text).frontmatter ?? {};
  return {
    id: path.slice('chapters/'.length, -'.md'.length),
    path,
    title: String(frontmatter.title),
    number: frontmatter.number,
    text,
  };
}

function read(files: Record<string, string>) {
  return readInkStory(
    Object.entries(files).map(([path, text]) => ({
      path,
      title: String(parseFrontmatter(text).frontmatter?.title ?? path),
      text,
    })),
    'Untitled',
  );
}

const opening: BeatProposal = {
  title: 'The Letter',
  ink: 'The keeper hands you a letter sealed in black wax.\n{trust > 0: She almost smiles.}',
  ending: false,
  summary: 'The keeper gives the reader a letter.',
  choices: [
    {
      text: 'Open the letter',
      intent: 'curiosity',
      consequence: 'learns who sent it',
      condition: '',
      effects: [],
      to: { kind: 'new', note: 'It is from your brother.' },
    },
    {
      text: 'Burn it unread',
      intent: 'refusal',
      consequence: 'the keeper stops trusting you',
      condition: '',
      effects: ['trust -= 1'],
      to: { kind: 'new', note: '' },
    },
    {
      text: 'Walk out into the storm',
      intent: 'flight',
      consequence: 'the story ends',
      condition: '',
      effects: [],
      to: { kind: 'end' },
    },
  ],
};

describe('the story setup', () => {
  it('round-trips through setup.md and the story kernel in story.md', () => {
    const setup = {
      mode: 'lead' as const,
      lookahead: 2 as const,
      choices: 3,
      beatLength: 'scene' as const,
      rejoin: 'often' as const,
      endings: 'Three, one "bittersweet"',
      kernel: 'A keeper on a rock gets a letter she cannot read.',
      shape: 'Short and cold. Around twenty beats on any path.',
    };
    const story = withKernel(STORY, setup.kernel);
    expect(parseFrontmatter(story).frontmatter?.['draft-mode']).toBe('discovered');
    expect(story).toContain('## Story Kernel\n\nA keeper on a rock');
    expect(readKernel(story)).toBe(setup.kernel);
    expect(readSetup(setupFile(setup), story)).toEqual(setup);
    // Writing the kernel again replaces it rather than adding a second section.
    const again = withKernel(story, 'Another kernel.');
    expect(again.match(/## Story Kernel/gu)).toHaveLength(1);
    expect(readKernel(again)).toBe('Another kernel.');
  });

  it('keeps the whole of a shape or kernel that has headings of its own', () => {
    const setup = {
      mode: 'lead' as const,
      lookahead: 1 as const,
      choices: 3,
      beatLength: 'scene' as const,
      rejoin: 'often' as const,
      endings: '',
      kernel: 'A keeper.\n\n## Want\n\nThe truth.',
      shape: '# Tone\n\nCold.\n\n## Length\n\nShort.',
    };
    const story = withKernel(STORY, setup.kernel);
    expect(readKernel(story)).toBe('A keeper.\n\n### Want\n\nThe truth.');
    expect(readSetup(setupFile(setup), story)?.shape).toBe(
      '### Tone\n\nCold.\n\n### Length\n\nShort.',
    );
  });

  it('reads no setup when the book has none, and the default rules when it has no rules file', () => {
    expect(readSetup(null, STORY)).toBeNull();
    expect(readRules(null)).toBe(DEFAULT_CHOICE_RULES);
    expect(readRules(rulesFile('1. Be kind.'))).toBe('1. Be kind.');
  });
});

describe('story variables', () => {
  it('makes a variable a model described loosely into one ink can declare', () => {
    expect(looseVariable({ name: 'trust-Mara', initial: 0, meaning: 'Trust\nin you' })).toEqual({
      name: 'trust_Mara',
      initial: '0',
      meaning: 'Trust in you',
    });
    expect(looseVariable({ name: 'knows', value: true, description: 'What she knows' })).toEqual({
      name: 'knows',
      initial: 'true',
      meaning: 'What she knows',
    });
    expect(looseVariable({ name: '2nd chance', initial: 'none', meaning: '' })).toEqual({
      name: 'v_2nd_chance',
      initial: '"none"',
      meaning: '',
    });
    expect(looseVariable({ name: 'not', initial: 'FALSE' })).toEqual({
      name: 'not_',
      initial: 'false',
      meaning: '',
    });
    expect(looseVariable({ name: '!!!', initial: '1' })).toBeNull();
    expect(looseVariable('trust')).toBeNull();
  });

  it('reads each VAR with the comment above it as its meaning', () => {
    const text =
      '---\ntitle: Story variables\n---\nCONST MAX = 3\n// How much Mara trusts you\nVAR trust = 0\nVAR met = false\n';
    expect(readVariables(text)).toEqual([
      { name: 'trust', initial: '0', meaning: 'How much Mara trusts you' },
      { name: 'met', initial: 'false', meaning: '' },
    ]);
    // A quoted // is part of the value; a comment after it is not.
    expect(
      readVariables('VAR site = "https://example.com" // where the letter came from\n'),
    ).toEqual([{ name: 'site', initial: '"https://example.com"', meaning: '' }]);
  });

  it('rewrites the agreed VARs in place, adds new ones, drops removed ones, and keeps other ink', () => {
    const text =
      '---\ntitle: Story variables\n---\nCONST MAX = 3\n// Old meaning\nVAR trust = 0\nVAR gone = 1\n';
    const after = withVariables(text, [
      { name: 'trust', initial: '1', meaning: 'How much Mara trusts you' },
      { name: 'burned_letter', initial: 'false', meaning: 'Whether you burned the letter' },
    ]);
    expect(after).toBe(
      '---\ntitle: Story variables\n---\nCONST MAX = 3\n// How much Mara trusts you\nVAR trust = 1\n// Whether you burned the letter\nVAR burned_letter = false\n',
    );
    expect(withVariables(null, [{ name: 'a', initial: '0', meaning: '' }])).toBe(
      '---\ntitle: Story variables\n---\nVAR a = 0\n',
    );
  });
});

describe('beats and seeds', () => {
  const vars = withVariables(null, [{ name: 'trust', initial: '0', meaning: 'trust' }]);

  function openingFiles() {
    const files = beatFiles({
      proposal: opening,
      chapter: { id: 'chapter-01', path: 'chapters/chapter-01.md', number: 1, text: null },
      from: null,
      chapters: [],
      nextNumber: 2,
    });
    return {
      files,
      book: {
        'story.md': STORY,
        'ink/variables.md': vars,
        [files.chapter.path]: files.chapter.text,
        ...Object.fromEntries(files.seeds.map((seed) => [seed.path, seed.text])),
      } as Record<string, string>,
    };
  }

  it('writes a beat with its choices and a seed for each new branch, and the story plays', () => {
    const { files, book } = openingFiles();
    expect(files.seeds.map((seed) => seed.path)).toEqual([
      'chapters/chapter-02.md',
      'chapters/chapter-03.md',
    ]);
    const chapter = files.chapter.text;
    expect(parseFrontmatter(chapter).frontmatter).toMatchObject({
      title: 'The Letter',
      number: 1,
      status: 'draft',
      mode: 'discovered',
      discover: 'written',
    });
    expect(chapter).toContain(
      '- **Burn it unread** (a new beat): refusal — the keeper stops trusting you',
    );
    expect(inkSection(chapter, 'chapter').ink).toContain(
      '* [Open the letter] -> chapter_02\n* [Burn it unread]\n    ~ trust -= 1\n    -> chapter_03\n* [Walk out into the storm] -> END\n',
    );
    expect(files.seeds[0]!.text).toContain(
      'Reached by choosing "Open the letter" in *The Letter*.\n\nIt is from your brother.',
    );

    const reading = read(book);
    expect(reading.compiled.diagnostics.filter((entry) => entry.severity === 'error')).toEqual([]);
    const knots = reading.assembled.chapters.map((entry) => ({
      knot: entry.knot,
      chapterId: entry.id,
      title: entry.title,
    }));
    const replayed = replayPosition(reading.compiled.json!, knots, ['trust'], {
      from: null,
      set: {},
      seed: 1,
      path: [1],
    });
    expect(replayed.current).toBe('chapter-03');
    expect(replayed.visited).toEqual(['chapter-01', 'chapter-03']);
    expect(replayed.variables).toEqual([{ name: 'trust', value: '-1' }]);
    expect(replayed.chosen).toEqual(['Burn it unread']);
    expect(transcriptText(replayed)).toContain(
      '## The Letter\n\nThe keeper hands you a letter sealed in black wax.\n\n> The reader chose: Burn it unread\n\n## Burn it unread',
    );
  });

  it('tells seeds, written beats, edited beats, and stale beats apart', () => {
    const { book } = openingFiles();
    const chapters = () =>
      Object.entries(book)
        .filter(([path]) => path.startsWith('chapters/'))
        .map(([path, text]) => chapterOf(path, text));
    let beats = discoverBeats(chapters(), new Set(['chapter-01']));
    expect(
      beats.map(({ chapterId, state, read, edited, stale }) => ({
        chapterId,
        state,
        read,
        edited,
        stale,
      })),
    ).toEqual([
      { chapterId: 'chapter-01', state: 'written', read: true, edited: false, stale: false },
      { chapterId: 'chapter-02', state: 'seed', read: false, edited: false, stale: false },
      { chapterId: 'chapter-03', state: 'seed', read: false, edited: false, stale: false },
    ]);
    expect(beats[1]!.note).toBe(
      'Reached by choosing "Open the letter" in *The Letter*.\n\nIt is from your brother.',
    );

    // Write the second beat from the first, then edit the first.
    const second = beatFiles({
      proposal: {
        ...opening,
        title: 'From your brother',
        choices: [],
        ending: true,
        ink: 'It is from Tom.',
      },
      chapter: {
        id: 'chapter-02',
        path: 'chapters/chapter-02.md',
        number: 2,
        text: book['chapters/chapter-02.md']!,
      },
      from: { id: 'chapter-01', ink: inkSection(book['chapters/chapter-01.md']!, 'chapter').ink },
      chapters: chapters(),
      nextNumber: 4,
    });
    book[second.chapter.path] = second.chapter.text;
    beats = discoverBeats(chapters(), new Set());
    expect(beats[1]).toMatchObject({
      state: 'written',
      ending: true,
      stale: false,
      edited: false,
      from: 'chapter-01',
    });

    book['chapters/chapter-01.md'] = book['chapters/chapter-01.md']!.replace(
      'black wax',
      'red wax',
    );
    beats = discoverBeats(chapters(), new Set());
    expect(beats[0]).toMatchObject({ edited: true });
    expect(beats[1]).toMatchObject({ stale: true, edited: false });

    // Marking it reviewed takes the parent as it is now.
    book['chapters/chapter-02.md'] = markReviewed(
      book['chapters/chapter-02.md']!,
      inkSection(book['chapters/chapter-01.md']!, 'chapter').ink,
    );
    expect(discoverBeats(chapters(), new Set())[1]).toMatchObject({ stale: false, edited: false });

    // A seed written over by hand is a written beat, and an edited one.
    book['chapters/chapter-03.md'] = book['chapters/chapter-03.md']!.replace(
      /TODO:[^\n]*\n-> END\n/u,
      'You burn it.\n-> END\n',
    );
    expect(discoverBeats(chapters(), new Set())[2]).toMatchObject({
      state: 'written',
      edited: true,
    });
  });

  it('finds what lead mode writes from where the reader is, nearest first', () => {
    const { book } = openingFiles();
    const chapters = Object.entries(book)
      .filter(([path]) => path.startsWith('chapters/'))
      .map(([path, text]) => chapterOf(path, text));
    const nodes = read(book).structure!.nodes;
    const beats = discoverBeats(chapters, new Set());
    expect(leadFrontier(beats, nodes, 'chapter-01', 1)).toEqual([
      { chapterId: 'chapter-02', kind: 'beat', depth: 1 },
      { chapterId: 'chapter-03', kind: 'beat', depth: 1 },
    ]);
    // The reader standing on a seed needs it written first.
    expect(leadFrontier(beats, nodes, 'chapter-02', 1)).toEqual([
      { chapterId: 'chapter-02', kind: 'beat', depth: 0 },
    ]);
  });

  it('asks for choices after a written beat that leads nowhere yet', () => {
    const files = beatFiles({
      proposal: { ...opening, choices: [], ending: false },
      chapter: { id: 'chapter-01', path: 'chapters/chapter-01.md', number: 1, text: null },
      from: null,
      chapters: [],
      nextNumber: 2,
    });
    const book = {
      'story.md': STORY,
      'ink/variables.md': vars,
      [files.chapter.path]: files.chapter.text,
    };
    const beats = discoverBeats([chapterOf(files.chapter.path, files.chapter.text)], new Set());
    const nodes = read(book).structure!.nodes;
    expect(leadFrontier(beats, nodes, 'chapter-01', 1)).toEqual([
      { chapterId: 'chapter-01', kind: 'choices', depth: 0 },
    ]);
  });

  it("adds the reader's own action as one more closing choice", () => {
    const { files } = openingFiles();
    const added = withAddedChoice(
      files.chapter.text,
      { text: 'Hand it back', once: true, condition: '', effects: [], to: 'chapter_04' },
      '- **Hand it back** (a new beat): the reader’s own action',
    )!;
    expect(inkSection(added, 'chapter').ink).toContain(
      '* [Walk out into the storm] -> END\n* [Hand it back] -> chapter_04\n',
    );
    expect(added).toContain(
      '- **Walk out into the storm** (the end): flight — the story ends\n- **Hand it back**',
    );
    // It is still the beat writer's beat, not an edited one.
    const chapter = chapterOf('chapters/chapter-01.md', added);
    expect(discoverBeats([chapter], new Set())[0]).toMatchObject({ edited: false });
  });

  it('keeps a seed note editable and numbers new chapters after the last', () => {
    const seed = seedChapter({
      number: 7,
      title: 'Hide it',
      fromId: 'chapter-01',
      fromTitle: 'The Letter',
      choiceText: 'Hide it',
      note: '',
    });
    const noted = withSeedNote(seed.text, 'She lies here.');
    const chapter = chapterOf(seed.path, noted);
    expect(discoverBeats([chapter], new Set())[0]).toMatchObject({
      state: 'seed',
      note: 'Reached by choosing "Hide it" in *The Letter*.\n\nShe lies here.',
    });
    expect(nextChapterNumber([chapter])).toBe(8);
    expect(inkHash('a  \nb\n\n')).toBe(inkHash('a\nb'));
  });
});
