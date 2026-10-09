import type {
  BookBranches,
  BookFile,
  BookPlay,
  BookSummary,
  BookTree,
  BranchChapter,
} from '@worldbookllm/shared';
import { cleanup, render, screen, within } from '@testing-library/react';
import { Compiler, CompilerOptions } from 'inkjs/full';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { AppRoutes } from '../App.js';
import { ApiProvider } from '../api/ApiContext.js';
import { ApiClientError, type ApiClient } from '../api/client.js';
import { createTestClient } from '../test/createTestClient.js';
import { markdownOf } from './play-markdown.js';

const HASH = 'a'.repeat(64);

const book: BookSummary = {
  slug: 'gull-rock',
  title: 'The Gull Rock Light',
  genre: 'mystery',
  status: 'drafting',
  kind: 'book',
  seriesId: null,
  bookNumber: null,
  follows: [],
  precedes: [],
  counts: { chapter: 3 },
  updatedAt: '2026-10-09T00:00:00.000Z',
};

const TITLES = { 'chapter-01': 'Harbor Wall', 'chapter-02': 'The Ledge', 'chapter-03': 'The Lamp' };

function chapterFile(id: keyof typeof TITLES): BookFile {
  return {
    path: `chapters/${id}.md`,
    kind: 'chapter',
    entityId: id,
    title: TITLES[id],
    hash: HASH,
    size: 10,
    updatedAt: book.updatedAt,
  };
}

const tree: BookTree = {
  book,
  files: [chapterFile('chapter-01'), chapterFile('chapter-02'), chapterFile('chapter-03')],
};

function chapter(id: keyof typeof TITLES, change: Partial<BranchChapter> = {}): BranchChapter {
  return {
    id,
    title: TITLES[id],
    path: `chapters/${id}.md`,
    hash: HASH,
    choices: [],
    problems: [],
    start: id === 'chapter-01',
    ending: false,
    reachable: true,
    ...change,
  };
}

function Location() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

function renderAt(path: string, overrides: Partial<ApiClient>) {
  const client = createTestClient({
    listBooks: () => Promise.resolve([book]),
    getBookTree: () => Promise.resolve(tree),
    ...overrides,
  });
  render(
    <ApiProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
        <Location />
      </MemoryRouter>
    </ApiProvider>,
  );
}

describe('Branches', () => {
  it('links from the Write tab and explains a linear book', async () => {
    const linear: BookBranches = {
      branching: false,
      ifid: null,
      invalidIfid: null,
      flags: [],
      chapters: [chapter('chapter-01'), chapter('chapter-02'), chapter('chapter-03')],
    };
    renderAt('/books/gull-rock/write', { getBranches: () => Promise.resolve(linear) });
    await userEvent
      .setup()
      .click(await screen.findByRole('link', { name: 'Branches and choices' }));
    expect(screen.getByTestId('location').textContent).toBe('/books/gull-rock/write/branches');
    expect((await screen.findByRole('status', { name: 'Story map' })).textContent).toContain(
      'reads straight through',
    );
    const first = screen.getByRole('form', { name: 'Harbor Wall' });
    expect(within(first).getByText('No choices: the reader goes on to The Ledge.')).toBeTruthy();
    expect(within(first).getByText('Start')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Play from the start' })).toBeTruthy();
  });

  it('adds a choice, validates it, and saves it with the hash it was read with', async () => {
    const linear: BookBranches = {
      branching: false,
      ifid: null,
      invalidIfid: null,
      flags: [],
      chapters: [chapter('chapter-01'), chapter('chapter-02'), chapter('chapter-03')],
    };
    const setChapterChoices = vi.fn(() => Promise.resolve(linear));
    renderAt('/books/gull-rock/write/branches', {
      getBranches: () => Promise.resolve(linear),
      setChapterChoices,
    });
    const user = userEvent.setup();
    const first = await screen.findByRole('form', { name: 'Harbor Wall' });
    await user.click(within(first).getByRole('button', { name: 'Add a choice' }));
    expect(
      within(first).getByText(/every chapter without choices\s+becomes an ending/u),
    ).toBeTruthy();

    await user.click(within(first).getByRole('button', { name: 'Save choices' }));
    expect(within(first).getByText('Add the words the reader picks.')).toBeTruthy();
    await user.type(within(first).getByLabelText('Choice 1'), 'Climb [[up]');
    expect(within(first).getByText(/cannot contain \[/u)).toBeTruthy();
    await user.clear(within(first).getByLabelText('Choice 1'));
    await user.type(within(first).getByLabelText('Choice 1'), 'Climb the tower');
    await user.selectOptions(within(first).getByLabelText('Leads to'), 'chapter-03');
    await user.click(within(first).getByRole('button', { name: 'Save choices' }));

    expect(setChapterChoices).toHaveBeenCalledWith('gull-rock', 'chapter-01', {
      expectedHash: HASH,
      choices: [{ text: 'Climb the tower', to: 'chapter-03', sets: [], requires: [] }],
    });
  });

  it('flags endings, unreachable chapters, and choices to missing chapters', async () => {
    const branching: BookBranches = {
      branching: true,
      ifid: null,
      invalidIfid: null,
      flags: [],
      chapters: [
        chapter('chapter-01', {
          choices: [
            { text: 'Search the rocks', to: 'chapter-02', sets: [], requires: [] },
            { text: 'Ghost', to: 'chapter-09', sets: [], requires: [] },
          ],
        }),
        chapter('chapter-02', { ending: true }),
        chapter('chapter-03', { ending: true, reachable: false }),
      ],
    };
    renderAt('/books/gull-rock/write/branches', { getBranches: () => Promise.resolve(branching) });
    const summary = await screen.findByRole('status', { name: 'Story map' });
    expect(summary.textContent).toContain('1 ending the reader can reach');
    expect(summary.textContent).toContain('No path of choices reaches The Lamp');
    expect(summary.textContent).toContain('the Twine and ink builds refuse choices');
    // Nothing to play until the broken choice is fixed.
    expect(screen.queryByRole('link', { name: 'Play from the start' })).toBeNull();

    const first = screen.getByRole('form', { name: 'Harbor Wall' });
    expect(within(first).getByText(/chapter-09 is not a chapter in this book/u)).toBeTruthy();
    const ledge = screen.getByRole('form', { name: 'The Ledge' });
    expect(within(ledge).getByText('Ending')).toBeTruthy();
    expect(
      within(screen.getByRole('form', { name: 'The Lamp' })).getByText('Not reachable'),
    ).toBeTruthy();

    // An ending can be turned into a link to the next chapter in one click.
    await userEvent
      .setup()
      .click(within(ledge).getByRole('button', { name: 'Continue to The Lamp' }));
    expect((within(ledge).getByLabelText('Choice 1') as HTMLInputElement).value).toBe('Continue');
  });

  it('pins the IFID', async () => {
    let ifid: string | null = null;
    const pinIfid = vi.fn(() => {
      ifid = '649C4AC9-78FE-4B32-B821-24D0802D1DD9';
      return Promise.resolve({ ifid });
    });
    renderAt('/books/gull-rock/write/branches', {
      getBranches: () =>
        Promise.resolve({
          branching: false,
          ifid,
          invalidIfid: null,
          flags: [],
          chapters: [chapter('chapter-01')],
        }),
      // Pinning writes story.md, so the tree reloads with a new hash.
      getBookTree: () =>
        Promise.resolve(
          ifid === null
            ? tree
            : { ...tree, files: [{ ...chapterFile('chapter-01'), hash: 'b'.repeat(64) }] },
        ),
      pinIfid,
    });
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Pin the IFID' }));
    expect(pinIfid).toHaveBeenCalledWith('gull-rock');
    expect(await screen.findByText('649C4AC9-78FE-4B32-B821-24D0802D1DD9')).toBeTruthy();
  });
});

describe('Branches edge cases', () => {
  it('lets a one-chapter book branch back to itself', async () => {
    const setChapterChoices = vi.fn(() =>
      Promise.resolve({ branching: true, ifid: null, invalidIfid: null, flags: [], chapters: [] }),
    );
    renderAt('/books/gull-rock/write/branches', {
      getBranches: () =>
        Promise.resolve({
          branching: false,
          ifid: null,
          invalidIfid: null,
          flags: [],
          chapters: [chapter('chapter-01')],
        }),
      setChapterChoices,
    });
    const user = userEvent.setup();
    const only = await screen.findByRole('form', { name: 'Harbor Wall' });
    await user.click(within(only).getByRole('button', { name: 'Add a choice' }));
    await user.type(within(only).getByLabelText('Choice 1'), 'Try again');
    await user.click(within(only).getByRole('button', { name: 'Save choices' }));
    expect(setChapterChoices).toHaveBeenCalledWith('gull-rock', 'chapter-01', {
      expectedHash: HASH,
      choices: [{ text: 'Try again', to: 'chapter-01', sets: [], requires: [] }],
    });
  });

  it('saves the flags a choice sets and requires, and checks them as typed', async () => {
    const setChapterChoices = vi.fn(() =>
      Promise.resolve({ branching: true, ifid: null, invalidIfid: null, flags: [], chapters: [] }),
    );
    renderAt('/books/gull-rock/write/branches', {
      getBranches: () =>
        Promise.resolve({
          branching: false,
          ifid: null,
          invalidIfid: null,
          flags: ['lamp_lit'],
          chapters: [chapter('chapter-01'), chapter('chapter-02')],
        }),
      setChapterChoices,
    });
    const user = userEvent.setup();
    expect((await screen.findByText(/Flags in this book/u)).textContent).toContain('lamp_lit');
    const first = screen.getByRole('form', { name: 'Harbor Wall' });
    await user.click(within(first).getByRole('button', { name: 'Add a choice' }));
    await user.type(within(first).getByLabelText('Choice 1'), 'Search the rocks');
    await user.type(within(first).getByLabelText('Sets flags'), 'chapter-02');
    await user.click(within(first).getByRole('button', { name: 'Save choices' }));
    expect(within(first).getByText(/chapter-02 is a chapter: a choice can require/u)).toBeTruthy();
    expect(setChapterChoices).not.toHaveBeenCalled();

    await user.clear(within(first).getByLabelText('Sets flags'));
    await user.type(within(first).getByLabelText('Sets flags'), 'found_coat,  not  lamp_lit, ');
    await user.type(within(first).getByLabelText('Only if'), 'lamp_lit, chapter-02');
    await user.click(within(first).getByRole('button', { name: 'Save choices' }));
    expect(setChapterChoices).toHaveBeenCalledWith('gull-rock', 'chapter-01', {
      expectedHash: HASH,
      choices: [
        {
          text: 'Search the rocks',
          to: 'chapter-02',
          sets: ['found_coat', 'not lamp_lit'],
          requires: ['lamp_lit', 'chapter-02'],
        },
      ],
    });
  });

  it('links each chapter to a play-through that starts there', async () => {
    renderAt('/books/gull-rock/write/branches', {
      getBranches: () =>
        Promise.resolve({
          branching: false,
          ifid: null,
          invalidIfid: null,
          flags: [],
          chapters: [chapter('chapter-01'), chapter('chapter-03')],
        }),
    });
    const lamp = await screen.findByRole('form', { name: 'The Lamp' });
    expect(within(lamp).getByRole('link', { name: 'Play from here' }).getAttribute('href')).toBe(
      '/books/gull-rock/write/play?from=chapter-03',
    );
  });

  it('offers to replace an IFID the builds would refuse', async () => {
    renderAt('/books/gull-rock/write/branches', {
      getBranches: () =>
        Promise.resolve({
          branching: false,
          ifid: null,
          invalidIfid: 'foo',
          flags: [],
          chapters: [chapter('chapter-01')],
        }),
    });
    expect(await screen.findByText(/which is not a valid IFID/u)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Replace the IFID' })).toBeTruthy();
  });
});

describe('Play', () => {
  // The shape story-skills' ink build writes: global tags, one knot per chapter.
  const source = [
    '# title: The Gull Rock Light',
    '# ifid: 649C4AC9-78FE-4B32-B821-24D0802D1DD9',
    '',
    'VAR found_coat = false',
    '',
    '-> chapter_01',
    '',
    '=== chapter_01 ===',
    'The tower door stands *open*.',
    '',
    '+ [Search the rocks]',
    '    ~ found_coat = true',
    '    -> chapter_02',
    '+ [Climb the tower] -> chapter_03',
    '',
    '=== chapter_02 ===',
    'An oilskin coat, empty.',
    '',
    '-> END',
    '',
    '=== chapter_03 ===',
    'The lamp is dark.',
    '',
    '-> END',
    '',
  ].join('\n');

  function play(): BookPlay {
    const compiled = new Compiler(source, new CompilerOptions(null, [], true)).Compile().ToJson();
    return {
      title: 'The Gull Rock Light',
      ifid: '649C4AC9-78FE-4B32-B821-24D0802D1DD9',
      source,
      story: compiled!,
      knots: (['chapter-01', 'chapter-02', 'chapter-03'] as const).map((id) => ({
        knot: id.replace('-', '_'),
        chapterId: id,
        title: TITLES[id],
      })),
      flags: ['found_coat'],
      warnings: [],
    };
  }

  it('runs the ink build through a choice to an ending, and starts over', async () => {
    renderAt('/books/gull-rock/write/play', { getPlay: () => Promise.resolve(play()) });
    const user = userEvent.setup();
    expect(await screen.findByRole('heading', { name: 'Harbor Wall' })).toBeTruthy();
    expect(screen.getByText('open').tagName).toBe('EM');
    expect(screen.getByText('ink source')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Climb the tower' }));
    expect(screen.getByTestId('location').textContent).toBe('/books/gull-rock/write/play?path=1');
    const heading = screen.getByRole('heading', { name: 'The Lamp' });
    expect(document.activeElement).toBe(heading);
    expect(screen.getByText('You chose: Climb the tower')).toBeTruthy();
    expect(screen.getByText('The end.')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Play again' }));
    expect(screen.getByRole('heading', { name: 'Harbor Wall' })).toBeTruthy();
  });

  it('shows the story state as choices change it', async () => {
    renderAt('/books/gull-rock/write/play', { getPlay: () => Promise.resolve(play()) });
    const user = userEvent.setup();
    const state = await screen.findByRole('region', { name: 'Story state' });
    expect(state.textContent).toContain('found_coat false');
    await user.click(screen.getByRole('button', { name: 'Search the rocks' }));
    expect(screen.getByRole('region', { name: 'Story state' }).textContent).toContain(
      'found_coat true',
    );
  });

  it('plays from a chapter, and back from the start', async () => {
    renderAt('/books/gull-rock/write/play?from=chapter-03', {
      getPlay: () => Promise.resolve(play()),
    });
    const user = userEvent.setup();
    expect(await screen.findByRole('heading', { name: 'The Lamp' })).toBeTruthy();
    expect(screen.getByText(/Playing from The Lamp, with every flag false/u)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Play again' }));
    expect(screen.getByTestId('location').textContent).toBe(
      '/books/gull-rock/write/play?from=chapter-03',
    );
    await user.click(screen.getByRole('button', { name: 'Play from the start' }));
    expect(screen.getByRole('heading', { name: 'Harbor Wall' })).toBeTruthy();
  });

  it('reopens the moment a link names, and stops where stale choices no longer fit', async () => {
    renderAt('/books/gull-rock/write/play?path=0', { getPlay: () => Promise.resolve(play()) });
    expect(await screen.findByRole('heading', { name: 'The Ledge' })).toBeTruthy();
    cleanup();
    renderAt('/books/gull-rock/write/play?path=0.3', { getPlay: () => Promise.resolve(play()) });
    expect(await screen.findByText(/The story has changed since these choices/u)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start over' })).toBeTruthy();
  });

  it('sends a story the build refuses back to the Branches screen', async () => {
    renderAt('/books/gull-rock/write/play', {
      getPlay: () =>
        Promise.reject(
          new ApiClientError(
            409,
            'story_unusable_project',
            'Cannot build ink until these are fixed:\nchapters/chapter-01.md choices[1] references missing chapter chapter-09',
          ),
        ),
    });
    expect(await screen.findByText(/references missing chapter chapter-09/u)).toBeTruthy();
    expect(
      screen
        .getByRole('link', { name: 'Fix the choices on the Branches screen' })
        .getAttribute('href'),
    ).toBe('/books/gull-rock/write/branches');
  });
});

describe('markdownOf', () => {
  it('keeps code, table rows, and list items together, and paragraphs apart', () => {
    expect(
      markdownOf([
        'The tide turns.',
        '```',
        'let x = 1',
        '',
        '```',
        '| a | b |',
        '|---|---|',
        '| 1 | 2 |',
        '- one',
        '- two',
        'Night falls.',
      ]),
    ).toBe(
      [
        'The tide turns.',
        '',
        '```',
        'let x = 1',
        '',
        '```',
        '',
        '| a | b |',
        '|---|---|',
        '| 1 | 2 |',
        '',
        '- one',
        '- two',
        '',
        'Night falls.',
      ].join('\n'),
    );
  });
});
