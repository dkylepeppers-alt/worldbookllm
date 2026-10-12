import type {
  BookFile,
  BookPlay,
  BookSummary,
  BookTree,
  ChapterEndingDetail,
  InteractiveStory,
  StoryNode,
} from '@worldbookllm/shared';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { Compiler, CompilerOptions } from 'inkjs/full';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppRoutes } from '../App.js';
import { ApiProvider } from '../api/ApiContext.js';
import { ApiClientError, type ApiClient } from '../api/client.js';
import { createTestClient } from '../test/createTestClient.js';
import { markdownOf } from './play-markdown.js';

const HASH = 'a'.repeat(64);
const TOKEN = 'b'.repeat(64);

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
  interactive: true,
};

const TITLES = { 'chapter-01': 'Harbor Wall', 'chapter-02': 'The Ledge', 'chapter-03': 'The Lamp' };
type ChapterId = keyof typeof TITLES;
const IDS = Object.keys(TITLES) as ChapterId[];
const knotOf = (id: string) => id.replace('-', '_');

function chapterFile(id: ChapterId): BookFile {
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

function treeOf(summary: BookSummary): BookTree {
  return { book: summary, files: IDS.map(chapterFile) };
}

const tree = treeOf(book);
const linear = treeOf({ ...book, interactive: false, needsInkConversion: false });

function node(id: ChapterId, change: Partial<StoryNode> = {}): StoryNode {
  return {
    name: knotOf(id),
    kind: 'chapter',
    chapterId: id,
    title: TITLES[id],
    path: `chapters/${id}.md`,
    line: null,
    choices: [],
    diverts: [],
    ends: false,
    reads: [],
    writes: [],
    words: 10,
    reachable: true,
    ...change,
  };
}

const choice = (text: string, target: string, condition: string | null = null) => ({
  text,
  once: true,
  condition,
  target,
  writes: [],
  line: 5,
});

function storyOf(nodes: StoryNode[], change: Partial<InteractiveStory> = {}): InteractiveStory {
  return {
    title: book.title,
    ifid: '649C4AC9-78FE-4B32-B821-24D0802D1DD9',
    chapters: IDS.map((id) => ({
      id,
      title: TITLES[id],
      path: `chapters/${id}.md`,
      hash: HASH,
      knot: knotOf(id),
    })),
    compiled: true,
    start: 'chapter_01',
    nodes,
    variables: [{ name: 'trust', kind: 'var', initial: '0', path: 'ink/variables.md', line: 4 }],
    diagnostics: [],
    ...change,
  };
}

const branching = storyOf([
  node('chapter-01', {
    choices: [choice('Climb', 'chapter_02'), choice('Wait', 'chapter_03', 'trust > 0')],
  }),
  node('chapter-02', { diverts: [{ target: 'chapter_03', kind: 'divert', line: 7 }] }),
  node('chapter-03', { ends: true }),
]);

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

afterEach(() => {
  localStorage.clear();
});

describe('Branches tab', () => {
  it('shows a book that is not interactive how to become one, after reviewing the changes', async () => {
    const getBookTree = vi.fn(() => Promise.resolve(linear));
    const convertToInk = vi.fn(() => Promise.resolve(book));
    renderAt('/books/gull-rock/write', {
      getBookTree,
      getInkConversion: () =>
        Promise.resolve({
          files: [
            {
              path: 'chapters/chapter-01.md',
              before: '---\ntitle: Harbor Wall\n---\nMara climbs.\n',
              after: '---\ntitle: Harbor Wall\n---\nMara climbs.\n\n-> chapter_02\n',
            },
            { path: 'ink/variables.md', before: null, after: '---\ntitle: Story variables\n---\n' },
          ],
          token: TOKEN,
        }),
      convertToInk,
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('link', { name: 'Make it interactive' }));
    expect(screen.getByRole('heading', { name: 'Make it interactive' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Or make an interactive edition' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Review the changes' }));
    const files = await screen.findByRole('list', { name: 'Files the conversion changes' });
    expect(within(files).getByText('new')).toBeTruthy();
    await user.click(within(files).getByRole('button', { name: 'chapters/chapter-01.md' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('-> chapter_02')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));

    const loads = getBookTree.mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'Convert to ink chapters' }));
    expect(convertToInk).toHaveBeenCalledWith('gull-rock', { token: TOKEN });
    await waitFor(() => expect(getBookTree.mock.calls.length).toBeGreaterThan(loads));
  });

  it('asks for a new review when the book changed since the preview', async () => {
    const getInkConversion = vi.fn(() =>
      Promise.resolve({
        files: [{ path: 'story.md', before: 'a', after: 'b' }],
        token: TOKEN,
      }),
    );
    renderAt('/books/gull-rock/branches', {
      getBookTree: () => Promise.resolve(linear),
      getInkConversion,
      convertToInk: () =>
        Promise.reject(
          new ApiClientError(
            409,
            'file_changed',
            'The book changed since you reviewed the conversion. Review it again.',
          ),
        ),
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Review the changes' }));
    await user.click(await screen.findByRole('button', { name: 'Convert to ink chapters' }));
    expect(await screen.findByText(/Review it again/u)).toBeTruthy();
    // The stale preview is gone, so nothing unreviewed can be converted.
    expect(screen.queryByRole('button', { name: 'Convert to ink chapters' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Review the changes' }));
    expect(getInkConversion).toHaveBeenCalledTimes(2);
  });

  it('offers a book in the earlier format the conversion, with its own tab', async () => {
    renderAt('/books/gull-rock/branches', {
      getBookTree: () =>
        Promise.resolve(treeOf({ ...book, interactive: false, needsInkConversion: true })),
    });
    expect(await screen.findByRole('heading', { name: 'Convert to ink chapters' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Branches' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Or make an interactive edition' })).toBeNull();
  });

  it('sums up an interactive story and maps its chapters, choices, and diverts', async () => {
    renderAt('/books/gull-rock/branches', {
      getInteractiveStory: () => Promise.resolve(branching),
    });
    expect(await screen.findByText('3 chapters · 2 choices · 1 ending · 1 variable')).toBeTruthy();
    const map = screen.getByRole('img', { name: /Map of 3 chapters and knots and 3 links/u });
    expect(
      within(map).getByText('Harbor Wall: “Wait” leads to The Lamp (only if trust > 0)'),
    ).toBeTruthy();
    expect(within(map).getByText('The Ledge goes on to The Lamp')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Play from the start' }).getAttribute('href')).toBe(
      '/books/gull-rock/branches/play',
    );
    const list = screen.getByText('The map as a list').closest('details')!;
    expect(within(list).getByRole('link', { name: 'Harbor Wall' }).getAttribute('href')).toBe(
      '/books/gull-rock/branches/edit#branch-chapter-01',
    );
  });

  it('says when the ink does not compile, and points to the problems', async () => {
    renderAt('/books/gull-rock/branches', {
      getInteractiveStory: () =>
        Promise.resolve(
          storyOf([], {
            compiled: false,
            start: null,
            variables: [],
            diagnostics: [
              {
                severity: 'error',
                message: 'Unexpected }',
                path: 'chapters/chapter-02.md',
                line: 9,
              },
            ],
          }),
        ),
    });
    expect(await screen.findByText(/The ink does not compile: 1 error/u)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See where' }).getAttribute('href')).toBe(
      '/books/gull-rock/health',
    );
    expect(screen.queryByRole('link', { name: 'Play from the start' })).toBeNull();
    expect(screen.getByText('The map appears once the ink compiles.')).toBeTruthy();
  });

  it('copies a linear book as an interactive edition and opens it', async () => {
    const createInteractiveEdition = vi.fn(() =>
      Promise.resolve({ ...book, slug: 'gull-rock-ie', title: 'Gull Rock: Choices' }),
    );
    renderAt('/books/gull-rock/branches', {
      getBookTree: () => Promise.resolve(linear),
      createInteractiveEdition,
    });
    const user = userEvent.setup();
    const title = await screen.findByLabelText('Edition title');
    await user.clear(title);
    await user.type(title, 'Gull Rock: Choices');
    await user.click(screen.getByRole('button', { name: 'Make an interactive edition' }));
    expect(createInteractiveEdition).toHaveBeenCalledWith('gull-rock', {
      title: 'Gull Rock: Choices',
    });
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/books/gull-rock-ie/branches'),
    );
  });
});

describe('Choices', () => {
  const ending = (change: Partial<ChapterEndingDetail> = {}): ChapterEndingDetail => ({
    hash: HASH,
    editable: true,
    reason: null,
    ending: { choices: [], then: 'chapter_02' },
    ...change,
  });

  it('adds a choice with a condition and what it changes, and saves it with the hash it read', async () => {
    const setChapterEnding = vi.fn(() => Promise.resolve(ending()));
    renderAt('/books/gull-rock/branches/edit', {
      getInteractiveStory: () => Promise.resolve(branching),
      getChapterEnding: (_slug, id) =>
        Promise.resolve(
          id === 'chapter-01' ? ending() : ending({ ending: { choices: [], then: 'END' } }),
        ),
      setChapterEnding,
    });
    const user = userEvent.setup();
    const card = (await screen.findByRole('heading', { name: 'Harbor Wall' })).closest('li')!;
    expect(await within(card).findByLabelText('With no choices, go on to')).toBeTruthy();
    await user.click(within(card).getByRole('button', { name: 'Add a choice' }));
    await user.click(within(card).getByRole('button', { name: 'Save choices' }));
    expect(within(card).getByText('Each choice needs text')).toBeTruthy();
    expect(setChapterEnding).not.toHaveBeenCalled();

    await user.type(within(card).getByLabelText('Choice 1'), 'Light the lamp');
    await user.selectOptions(within(card).getByLabelText('Leads to'), 'chapter_03');
    await user.type(within(card).getByLabelText('Only if'), 'not lamp_lit');
    await user.type(within(card).getByLabelText('When picked'), 'lamp_lit = true{Enter}trust += 1');
    await user.click(within(card).getByLabelText('Offer only once'));
    await user.click(within(card).getByRole('button', { name: 'Save choices' }));
    expect(setChapterEnding).toHaveBeenCalledWith('gull-rock', 'chapter-01', {
      expectedHash: HASH,
      ending: {
        then: 'chapter_02',
        choices: [
          {
            text: 'Light the lamp',
            to: 'chapter_03',
            once: true,
            condition: 'not lamp_lit',
            effects: ['lamp_lit = true', 'trust += 1'],
          },
        ],
      },
    });
  });

  it('offers to save only once something changed', async () => {
    renderAt('/books/gull-rock/branches/edit', {
      getInteractiveStory: () => Promise.resolve(branching),
      getChapterEnding: () =>
        Promise.resolve(
          ending({
            ending: {
              then: 'END',
              choices: [
                {
                  text: 'Climb',
                  once: false,
                  condition: 'trust > 0',
                  effects: ['trust += 1'],
                  to: 'chapter_02',
                },
              ],
            },
          }),
        ),
    });
    const user = userEvent.setup();
    const card = (await screen.findByRole('heading', { name: 'Harbor Wall' })).closest('li')!;
    const text = await within(card).findByLabelText('Choice 1');
    expect(within(card).queryByRole('button', { name: 'Save choices' })).toBeNull();
    await user.type(text, '!');
    expect(within(card).getByRole('button', { name: 'Save choices' })).toBeTruthy();
  });

  it('sends an ending it cannot show to the ink editor', async () => {
    renderAt('/books/gull-rock/branches/edit', {
      getInteractiveStory: () => Promise.resolve(branching),
      getChapterEnding: (_slug, id) =>
        Promise.resolve(
          id === 'chapter-01'
            ? ending({
                editable: false,
                reason: 'The chapter ends inside a weave of choices; edit its ending as ink.',
              })
            : ending(),
        ),
    });
    expect(await screen.findByText(/ends inside a weave of choices/u)).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Choices in Harbor Wall' }).textContent).toContain(
      'Wait → chapter_03 (only if trust > 0)',
    );
    expect(screen.getByRole('link', { name: 'Edit Harbor Wall as ink' }).getAttribute('href')).toBe(
      '/books/gull-rock/files/chapters/chapter-01.md',
    );
  });

  it('offers a reload when the chapter changed since it was read, and shows compile errors', async () => {
    const getBookTree = vi.fn(() => Promise.resolve(tree));
    const setChapterEnding = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiClientError(
          400,
          'validation_failed',
          'The ending does not compile:\nchapters/chapter-01.md:9: Divert target not found: -> nowhere',
        ),
      )
      .mockRejectedValueOnce(
        new ApiClientError(409, 'file_changed', 'chapters/chapter-01.md changed.'),
      );
    renderAt('/books/gull-rock/branches/edit', {
      getBookTree,
      getInteractiveStory: () => Promise.resolve(branching),
      getChapterEnding: () => Promise.resolve(ending()),
      setChapterEnding,
    });
    const user = userEvent.setup();
    const card = (await screen.findByRole('heading', { name: 'Harbor Wall' })).closest('li')!;
    await user.selectOptions(
      await within(card).findByLabelText('With no choices, go on to'),
      'END',
    );
    await user.click(within(card).getByRole('button', { name: 'Save choices' }));
    expect(await within(card).findByText(/Divert target not found/u)).toBeTruthy();
    expect(within(card).queryByRole('button', { name: /Reload/u })).toBeNull();

    await user.click(within(card).getByRole('button', { name: 'Save choices' }));
    const loads = getBookTree.mock.calls.length;
    await user.click(await within(card).findByRole('button', { name: 'Reload Harbor Wall' }));
    await waitFor(() => expect(getBookTree.mock.calls.length).toBeGreaterThan(loads));
  });

  it('sends a book that is not interactive to the Branches tab', async () => {
    renderAt('/books/gull-rock/branches/edit', { getBookTree: () => Promise.resolve(linear) });
    expect(await screen.findByRole('heading', { name: 'Make it interactive' })).toBeTruthy();
    expect(screen.getByTestId('location').textContent).toBe('/books/gull-rock/branches');
  });
});

describe('Health', () => {
  function report(_slug: string, command: string) {
    return Promise.resolve({
      command: command as 'report' | 'next',
      exitCode: 0,
      envelope: {
        apiVersion: 'story/v2',
        command,
        ok: true,
        data: command === 'report' ? { checks: {} } : { actions: [] },
        diagnostics: [],
      },
    });
  }

  it('lists what the ink compiler and the story structure say, with the file and line', async () => {
    renderAt('/books/gull-rock/health', {
      runBookCheck: report,
      getInteractiveStory: () =>
        Promise.resolve(
          storyOf([], {
            diagnostics: [
              {
                severity: 'error',
                message: 'Unexpected }',
                path: 'chapters/chapter-02.md',
                line: 9,
              },
              {
                severity: 'warning',
                message: 'Nothing leads to The Lamp (chapter_03)',
                path: 'chapters/chapter-03.md',
                line: null,
              },
              {
                severity: 'todo',
                message: 'Write the cellar',
                path: 'chapters/chapter-01.md',
                line: 4,
              },
            ],
          }),
        ),
    });
    const findings = await screen.findByRole('list', { name: 'Ink findings' });
    expect(findings.textContent).toContain('Unexpected }');
    expect(findings.textContent).toContain('to do');
    expect(
      within(findings)
        .getByRole('link', { name: 'chapters/chapter-02.md, line 9' })
        .getAttribute('href'),
    ).toBe('/books/gull-rock/files/chapters/chapter-02.md');
  });

  it('has no Ink section for a book that is not interactive', async () => {
    renderAt('/books/gull-rock/health', {
      getBookTree: () => Promise.resolve(linear),
      runBookCheck: report,
    });
    expect(await screen.findByRole('heading', { name: 'Next' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Ink' })).toBeNull();
  });
});

describe('Builds', () => {
  it('offers an interactive book its own exports, the playable page first', async () => {
    const createBuild = vi.fn(() =>
      Promise.resolve({
        file: { name: 'gull-rock.html', size: 2048, updatedAt: book.updatedAt },
        output: 'Wrote dist/gull-rock.html.',
      }),
    );
    renderAt('/books/gull-rock/project', { listBuilds: () => Promise.resolve([]), createBuild });
    const user = userEvent.setup();
    const format = await screen.findByLabelText('Format');
    expect(
      within(format)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([
      'Playable web page (HTML)',
      'ink story for Inky (.ink)',
      'Compiled ink for game engines (JSON)',
    ]);
    expect(document.getElementById('build-format-hint')?.textContent).toContain('Inky');
    await user.click(screen.getByRole('button', { name: 'Build' }));
    expect(createBuild).toHaveBeenCalledWith('gull-rock', { format: 'web' });
  });
});

describe('moved addresses', () => {
  it('sends the old Write addresses to the Branches tab, keeping the query', async () => {
    renderAt('/books/gull-rock/write/play?from=chapter-03', {
      getPlay: () => Promise.reject(new ApiClientError(409, 'x', 'not now')),
    });
    await screen.findByText('not now');
    expect(screen.getByTestId('location').textContent).toBe(
      '/books/gull-rock/branches/play?from=chapter-03',
    );
  });
});

describe('Play', () => {
  // As worldbookllm assembles it: each chapter a knot opening with its chapter tag.
  const source = [
    '# title: The Gull Rock Light',
    '-> chapter_01',
    'VAR found_coat = false',
    'VAR trust = 0',
    '',
    '=== chapter_01 ===',
    '# chapter: Harbor Wall',
    'The tower door stands *open*. Gulls {~cry|wheel|scatter}.',
    '',
    '+ [Search the rocks]',
    '    ~ found_coat = true',
    '    ~ trust += 2',
    '    -> chapter_02',
    '+ [Climb the tower] -> chapter_03',
    '+ [Wait] -> chapter_01',
    '',
    '=== chapter_02 ===',
    '# chapter: The Ledge',
    'An oilskin coat, empty.',
    '# break',
    'Later, the tide.',
    '-> END',
    '',
    '=== chapter_03 ===',
    '# chapter: The Lamp',
    'The lamp is dark. {trust > 1: Venn trusts you.}',
    '-> cellar',
    '= cellar',
    'The cellar is damp.',
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
      knots: IDS.map((id) => ({ knot: knotOf(id), chapterId: id, title: TITLES[id] })),
      paths: ['chapter_01', 'chapter_02', 'chapter_03', 'chapter_03.cellar'],
      variables: [
        { name: 'found_coat', kind: 'var' },
        { name: 'trust', kind: 'var' },
      ],
      warnings: [],
    };
  }

  const getPlay = () => Promise.resolve(play());

  it('runs the story through a choice to an ending, with scene breaks, and plays again', async () => {
    renderAt('/books/gull-rock/branches/play', { getPlay });
    const user = userEvent.setup();
    expect(await screen.findByRole('heading', { name: 'Harbor Wall' })).toBeTruthy();
    expect(screen.getByText('open').tagName).toBe('EM');

    await user.click(screen.getByRole('button', { name: 'Search the rocks' }));
    expect(screen.getByTestId('location').textContent).toBe(
      '/books/gull-rock/branches/play?seed=1&path=0',
    );
    const heading = screen.getByRole('heading', { name: 'The Ledge' });
    expect(document.activeElement).toBe(heading);
    expect(screen.getByText('You chose: Search the rocks')).toBeTruthy();
    expect(heading.closest('section')!.querySelector('hr')).not.toBeNull();
    expect(screen.getByText('The end.')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Play again' }));
    expect(screen.getByRole('heading', { name: 'Harbor Wall' })).toBeTruthy();
    expect(screen.getByTestId('location').textContent).toMatch(
      /^\/books\/gull-rock\/branches\/play\?seed=\d+$/u,
    );
  });

  it('replays random text the same way for the same seed', async () => {
    renderAt('/books/gull-rock/branches/play?seed=42', { getPlay });
    const first = (await screen.findByRole('heading', { name: 'Harbor Wall' })).closest(
      'section',
    )!.textContent;
    cleanup();
    renderAt('/books/gull-rock/branches/play?seed=42', { getPlay });
    const again = (await screen.findByRole('heading', { name: 'Harbor Wall' })).closest(
      'section',
    )!.textContent;
    expect(again).toBe(first);
  });

  it('shows every variable as choices change it', async () => {
    renderAt('/books/gull-rock/branches/play', { getPlay });
    const user = userEvent.setup();
    const state = await screen.findByRole('region', { name: 'Story state' });
    expect(state.textContent).toContain('found_coat false');
    expect(state.textContent).toContain('trust 0');
    await user.click(screen.getByRole('button', { name: 'Search the rocks' }));
    const after = screen.getByRole('region', { name: 'Story state' }).textContent;
    expect(after).toContain('found_coat true');
    expect(after).toContain('trust 2');
  });

  it('plays from a stitch with variables set first, and from a chapter id in older links', async () => {
    renderAt('/books/gull-rock/branches/play', { getPlay });
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Harbor Wall' });
    await user.click(screen.getByText('Playtest from anywhere'));
    await user.selectOptions(screen.getByLabelText('Start from'), 'chapter_03');
    await user.type(screen.getByRole('textbox', { name: 'trust' }), '5');
    await user.click(screen.getByRole('button', { name: 'Start playing' }));
    expect(screen.getByTestId('location').textContent).toBe(
      '/books/gull-rock/branches/play?from=chapter_03&set=trust%3A5&seed=1',
    );
    const passage = () => screen.getByRole('article', { name: 'Story' });
    expect(within(passage()).getByText(/Venn trusts you/u)).toBeTruthy();
    expect(screen.getByText(/Playing from The Lamp, with trust = 5/u)).toBeTruthy();

    cleanup();
    renderAt('/books/gull-rock/branches/play?from=chapter_03.cellar', { getPlay });
    expect(
      await within(await screen.findByRole('article', { name: 'Story' })).findByText(
        'The cellar is damp.',
      ),
    ).toBeTruthy();
    expect(within(passage()).queryByText(/The lamp is dark/u)).toBeNull();

    cleanup();
    renderAt('/books/gull-rock/branches/play?from=chapter-02', { getPlay });
    expect(await screen.findByRole('heading', { name: 'The Ledge' })).toBeTruthy();
  });

  it('skips a preset variable whose value is not a valid escape', async () => {
    renderAt('/books/gull-rock/branches/play?set=trust:%25E0,found_coat:true', { getPlay });
    expect(await screen.findByRole('heading', { name: 'Harbor Wall' })).toBeTruthy();
    const state = screen.getByRole('region', { name: 'Story state' }).textContent;
    expect(state).toContain('found_coat true');
    expect(state).toContain('trust 0');
  });

  it('saves a moment and reopens it', async () => {
    renderAt('/books/gull-rock/branches/play?seed=7&path=0', { getPlay });
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'The Ledge' });
    await user.click(screen.getByText('Saves (0)'));
    await user.type(screen.getByLabelText('Name this moment'), 'Found the coat');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(screen.getByRole('button', { name: 'Play again' }));
    await user.click(screen.getByRole('button', { name: 'Found the coat' }));
    expect(screen.getByTestId('location').textContent).toBe(
      '/books/gull-rock/branches/play?seed=7&path=0',
    );
  });

  it('heads the chapter again when a choice leads back to it', async () => {
    renderAt('/books/gull-rock/branches/play?path=2', { getPlay });
    const heading = await screen.findByRole('heading', { name: 'Harbor Wall' });
    expect(heading.closest('section')!.textContent).toContain('The tower door stands');
    expect(screen.getByText('You chose: Wait')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Edit Harbor Wall' })).toBeTruthy();
  });

  it('stops where stale choices no longer fit, and starts over on a path with an empty step', async () => {
    renderAt('/books/gull-rock/branches/play?path=0.3', { getPlay });
    expect(await screen.findByText(/The story has changed since these choices/u)).toBeTruthy();
    cleanup();
    renderAt('/books/gull-rock/branches/play?path=0..0', { getPlay });
    expect(await screen.findByRole('heading', { name: 'Harbor Wall' })).toBeTruthy();
    expect(screen.queryByText(/You chose/u)).toBeNull();
  });

  it('sends a story that does not compile to Health', async () => {
    renderAt('/books/gull-rock/branches/play', {
      getPlay: () =>
        Promise.reject(
          new ApiClientError(
            409,
            'ink_compile_failed',
            'The ink does not compile yet:\nchapters/chapter-01.md:9: Unexpected }',
          ),
        ),
    });
    expect(await screen.findByText(/Unexpected \}/u)).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'See every problem on Health' }).getAttribute('href'),
    ).toBe('/books/gull-rock/health');
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
