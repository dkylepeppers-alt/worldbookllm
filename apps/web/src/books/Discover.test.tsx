import type {
  BookFile,
  BookPlay,
  BookSummary,
  BookTree,
  DiscoverBeat,
  DiscoverJob,
  DiscoverState,
} from '@worldbookllm/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Compiler, CompilerOptions } from 'inkjs/full';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppRoutes } from '../App.js';
import { ApiProvider } from '../api/ApiContext.js';
import type { ApiClient } from '../api/client.js';
import { NO_DISCOVERY, createTestClient } from '../test/createTestClient.js';

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
  updatedAt: '2026-10-13T00:00:00.000Z',
  interactive: true,
};

const TITLES = {
  'chapter-01': 'The Letter',
  'chapter-02': 'Open the letter',
  'chapter-03': 'Burn it',
};
type ChapterId = keyof typeof TITLES;
const IDS = Object.keys(TITLES) as ChapterId[];

function file(id: ChapterId): BookFile {
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

const tree: BookTree = { book, files: IDS.map(file) };

const source = [
  '# title: The Gull Rock Light',
  '-> chapter_01',
  'VAR trust = 0',
  '=== chapter_01 ===',
  '# chapter: The Letter',
  'The keeper hands you a letter.',
  '* [Open the letter] -> chapter_02',
  '* [Burn it] -> chapter_03',
  '=== chapter_02 ===',
  '# chapter: Open the letter',
  '-> END',
  '=== chapter_03 ===',
  '# chapter: Burn it',
  'It curls in the flame.',
  '-> END',
  '',
].join('\n');

function play(): BookPlay {
  return {
    title: book.title,
    ifid: null,
    source,
    story: new Compiler(source, new CompilerOptions(null, [], true)).Compile().ToJson()!,
    knots: IDS.map((id) => ({ knot: id.replace('-', '_'), chapterId: id, title: TITLES[id] })),
    paths: ['chapter_01', 'chapter_02', 'chapter_03'],
    variables: [{ name: 'trust', kind: 'var' }],
    warnings: [],
  };
}

function beat(id: ChapterId, change: Partial<DiscoverBeat> = {}): DiscoverBeat {
  return {
    chapterId: id,
    title: TITLES[id],
    path: `chapters/${id}.md`,
    knot: id.replace('-', '_'),
    state: 'written',
    ending: false,
    read: false,
    edited: false,
    stale: false,
    from: id === 'chapter-01' ? null : 'chapter-01',
    note: '',
    ...change,
  };
}

function job(change: Partial<DiscoverJob>): DiscoverJob {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    kind: 'beat',
    chapterId: null,
    title: 'Working',
    status: 'done',
    message: null,
    drafts: [],
    outcome: null,
    variables: [],
    createdAt: book.updatedAt,
    ...change,
  };
}

const discovering: DiscoverState = {
  ...NO_DISCOVERY,
  setup: {
    mode: 'cowrite',
    lookahead: 1,
    choices: 2,
    beatLength: 'scene',
    rejoin: 'sometimes',
    endings: '',
    kernel: 'A keeper and a letter.',
    shape: '',
  },
  rules: '1. Different intents.',
  variables: [{ name: 'trust', initial: '0', meaning: 'How much the keeper trusts you' }],
  beats: [
    beat('chapter-01'),
    beat('chapter-02', {
      state: 'seed',
      note: 'Reached by choosing "Open the letter" in *The Letter*.\n\nIt is from her brother.',
    }),
    beat('chapter-03', { ending: true }),
  ],
  openThreads: [
    { chapterId: 'chapter-02', title: 'Open the letter', from: 'chapter-01', playPath: [0] },
  ],
  closingChoices: { 'chapter-01': ['Open the letter', 'Burn it'] },
  writerReady: true,
  writerProblem: null,
};

function Location() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

function renderAt(path: string, overrides: Partial<ApiClient>) {
  const client = createTestClient({
    listBooks: () => Promise.resolve([book]),
    getBookTree: () => Promise.resolve(tree),
    getPlay: () => Promise.resolve(play()),
    getDiscover: () => Promise.resolve(discovering),
    setDiscoverPosition: () => Promise.resolve(discovering),
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

describe('Story setup', () => {
  it('saves the premise, mode, variables, and rules, then opens Play', async () => {
    const saveDiscoverSetup = vi.fn<ApiClient['saveDiscoverSetup']>(() =>
      Promise.resolve(discovering),
    );
    renderAt('/books/gull-rock/branches/discover', {
      getDiscover: () =>
        Promise.resolve({
          ...NO_DISCOVERY,
          rules: '1. Default rule.',
          writerReady: true,
          writerProblem: null,
        }),
      saveDiscoverSetup,
    });
    const user = userEvent.setup();
    const save = await screen.findByRole('button', { name: 'Save and start playing' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Write the premise first.')).toBeTruthy();
    await user.type(screen.getByLabelText(/^Premise/u), 'A keeper and a letter.');
    await user.click(screen.getByLabelText('Two steps: about three times as many model calls'));
    await user.click(screen.getByRole('button', { name: 'Add a variable' }));
    const row = within(screen.getByRole('list', { name: 'Variables' })).getByRole('listitem');
    await user.type(within(row).getByLabelText('Name'), 'trust');
    await user.type(within(row).getByLabelText('What it means'), 'How much she trusts you');
    expect((screen.getByLabelText('Rules for choices') as HTMLTextAreaElement).value).toBe(
      '1. Default rule.',
    );
    await user.click(save);

    await waitFor(() => expect(saveDiscoverSetup).toHaveBeenCalled());
    const [slug, input] = saveDiscoverSetup.mock.calls[0]!;
    expect(slug).toBe('gull-rock');
    expect(input).toMatchObject({
      setup: { mode: 'lead', lookahead: 2, choices: 3, kernel: 'A keeper and a letter.' },
      rules: '1. Default rule.',
      variables: [{ name: 'trust', initial: '0', meaning: 'How much she trusts you' }],
    });
    // The book has chapters, so there is no opening to write.
    expect('opening' in input).toBe(false);
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/books/gull-rock/branches/play'),
    );
  });

  it('says when the provider cannot run the beat writer', async () => {
    renderAt('/books/gull-rock/branches/discover', {
      getDiscover: () => Promise.resolve(NO_DISCOVERY),
    });
    expect(await screen.findByText(/Configure a provider in Settings/u)).toBeTruthy();
  });
});

describe('Play while discovering', () => {
  it('reports where the reader is, and at a beat not written yet offers drafts to pick from', async () => {
    const setDiscoverPosition = vi.fn<ApiClient['setDiscoverPosition']>(() =>
      Promise.resolve(discovering),
    );
    const drafts = job({
      kind: 'drafts',
      chapterId: 'chapter-02',
      title: 'Drafting "Open the letter"',
      drafts: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          title: 'Tom',
          ink: 'Tom wrote it.\n-> END\n',
          prose: 'Tom wrote it.',
          choices: [],
          ending: true,
        },
        {
          id: '33333333-3333-4333-8333-333333333333',
          title: 'A summons',
          ink: '…',
          prose: 'You are summoned.',
          choices: [{ text: 'Go', intent: 'duty', leads: 'A new beat' }],
          ending: false,
        },
      ],
    });
    const draftDiscoverBeat = vi.fn<ApiClient['draftDiscoverBeat']>(() =>
      Promise.resolve({ ...discovering, jobs: [drafts] }),
    );
    const acceptDiscoverDraft = vi.fn<ApiClient['acceptDiscoverDraft']>(() =>
      Promise.resolve(discovering),
    );
    renderAt('/books/gull-rock/branches/play', {
      setDiscoverPosition,
      draftDiscoverBeat,
      acceptDiscoverDraft,
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Open the letter' }));

    await waitFor(() =>
      expect(setDiscoverPosition).toHaveBeenLastCalledWith('gull-rock', {
        from: null,
        set: {},
        seed: 1,
        path: [0],
      }),
    );
    expect(screen.getByRole('heading', { name: 'Not written yet' })).toBeTruthy();
    expect(screen.getByText('Reached by choosing "Open the letter" in *The Letter*.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Write it yourself' }).getAttribute('href')).toBe(
      '/books/gull-rock/files/chapters/chapter-02.md',
    );
    expect(screen.queryByText('The end.')).toBeNull();

    await user.type(screen.getByLabelText('Direction (optional)'), 'Darker');
    await user.click(screen.getByRole('button', { name: 'Draft three directions' }));
    expect(draftDiscoverBeat).toHaveBeenCalledWith('gull-rock', {
      chapterId: 'chapter-02',
      position: { from: null, set: {}, seed: 1, path: [0] },
      direction: 'Darker',
    });
    const list = await screen.findByRole('list', { name: 'Drafts' });
    expect(within(list).getByText('You are summoned.')).toBeTruthy();
    expect(within(list).getByText('Go')).toBeTruthy();
    await user.click(within(list).getAllByRole('button', { name: 'Use this draft' })[1]!);
    expect(acceptDiscoverDraft).toHaveBeenCalledWith(
      'gull-rock',
      drafts.id,
      '33333333-3333-4333-8333-333333333333',
    );
  });

  it("offers Something else at every choice, and shows the beat writer's reason when it declines", async () => {
    const declined = job({
      kind: 'something-else',
      chapterId: 'chapter-01',
      outcome: { accepted: false, reason: 'There is no boat here.', suggestion: 'Signal the ship' },
    });
    const somethingElse = vi.fn<ApiClient['somethingElse']>(() =>
      Promise.resolve({ ...discovering, jobs: [declined] }),
    );
    renderAt('/books/gull-rock/branches/play', { somethingElse });
    const user = userEvent.setup();
    const choices = await screen.findByRole('list', { name: 'Choices' });
    await user.click(within(choices).getByRole('button', { name: 'Something else…' }));
    await user.type(screen.getByLabelText('What do you do?'), 'Row away');
    await user.click(screen.getByRole('button', { name: 'Try it' }));
    expect(somethingElse).toHaveBeenCalledWith('gull-rock', {
      position: { from: null, set: {}, seed: 1, path: [] },
      action: 'Row away',
    });
    expect(await screen.findByText('There is no boat here.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try: Signal the ship' }));
    expect((screen.getByLabelText('What do you do?') as HTMLInputElement).value).toBe(
      'Signal the ship',
    );
  });

  it('offers Something else only at a beat’s closing choices, not inside a scene', async () => {
    const inScene = { ...discovering, closingChoices: {} };
    renderAt('/books/gull-rock/branches/play', {
      getDiscover: () => Promise.resolve(inScene),
      setDiscoverPosition: () => Promise.resolve(inScene),
    });
    const choices = await screen.findByRole('list', { name: 'Choices' });
    expect(within(choices).getByRole('button', { name: 'Open the letter' })).toBeTruthy();
    expect(within(choices).queryByRole('button', { name: 'Something else…' })).toBeNull();
  });

  it('shows the newest drafts job at a seed, so a retry replaces a failure', async () => {
    const failed = job({
      kind: 'drafts',
      chapterId: 'chapter-02',
      status: 'failed',
      message: 'Old failure',
    });
    const retry = job({
      id: '55555555-5555-4555-8555-555555555555',
      kind: 'drafts',
      chapterId: 'chapter-02',
      status: 'running',
    });
    const retrying = { ...discovering, jobs: [failed, retry] };
    renderAt('/books/gull-rock/branches/play?seed=1&path=0', {
      getDiscover: () => Promise.resolve(retrying),
      setDiscoverPosition: () => Promise.resolve(retrying),
    });
    expect(await screen.findByText(/Drafting three directions/u)).toBeTruthy();
    expect(screen.queryByText('Old failure')).toBeNull();
  });

  it('plays the reader’s own action once it is a choice', async () => {
    const accepted = job({
      kind: 'something-else',
      chapterId: 'chapter-01',
      outcome: { accepted: true, chapterId: 'chapter-01', choice: 1 },
    });
    const dismissDiscoverJob = vi.fn<ApiClient['dismissDiscoverJob']>(() =>
      Promise.resolve(discovering),
    );
    renderAt('/books/gull-rock/branches/play', {
      somethingElse: () => Promise.resolve({ ...discovering, jobs: [accepted] }),
      dismissDiscoverJob,
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Something else…' }));
    await user.type(screen.getByLabelText('What do you do?'), 'burn it');
    await user.click(screen.getByRole('button', { name: 'Try it' }));
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/books/gull-rock/branches/play?seed=1&path=1',
      ),
    );
    expect(dismissDiscoverJob).toHaveBeenCalledWith('gull-rock', accepted.id);
  });

  it('shows the path taken, each step a way back, and offers a rewrite with a direction', async () => {
    const writeDiscoverBeat = vi.fn<ApiClient['writeDiscoverBeat']>(() =>
      Promise.resolve(discovering),
    );
    renderAt('/books/gull-rock/branches/play?seed=1&path=1', { writeDiscoverBeat });
    const user = userEvent.setup();
    expect(await screen.findByText('It curls in the flame.')).toBeTruthy();
    const trail = screen.getByRole('navigation', { name: 'Your path' });
    expect(within(trail).getByText('Burn it').getAttribute('aria-current')).toBe('step');
    // An ending the beat writer wrote on purpose is the end.
    expect(screen.getByText('The end.')).toBeTruthy();

    await user.click(screen.getByText('Rewrite Burn it'));
    await user.type(screen.getByLabelText('How should it change?'), 'Slower');
    await user.click(screen.getByRole('button', { name: 'Rewrite it' }));
    expect(writeDiscoverBeat).toHaveBeenCalledWith('gull-rock', {
      chapterId: 'chapter-03',
      position: { from: null, set: {}, seed: 1, path: [1] },
      direction: 'Slower',
    });
    await user.click(within(trail).getByRole('button', { name: 'Start' }));
    expect(screen.getByTestId('location').textContent).toBe(
      '/books/gull-rock/branches/play?seed=1',
    );
  });

  it('lists the variables the beat writer asks for, to add or decline', async () => {
    const decideDiscoverProposal = vi.fn<ApiClient['decideDiscoverProposal']>(() =>
      Promise.resolve(discovering),
    );
    const asking: DiscoverState = {
      ...discovering,
      proposals: [
        {
          id: '44444444-4444-4444-8444-444444444444',
          variable: { name: 'read_letter', initial: 'false', meaning: 'Whether you read it' },
          reason: 'Later beats change.',
          chapterId: 'chapter-02',
          createdAt: book.updatedAt,
        },
      ],
    };
    renderAt('/books/gull-rock/branches/play', {
      getDiscover: () => Promise.resolve(asking),
      setDiscoverPosition: () => Promise.resolve(asking),
      decideDiscoverProposal,
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add it' }));
    expect(decideDiscoverProposal).toHaveBeenCalledWith(
      'gull-rock',
      '44444444-4444-4444-8444-444444444444',
      { approve: true },
    );
  });
});

describe('Discovery on the Branches tab and Health', () => {
  it('lists open threads with a way into Play, and marks a beat reviewed', async () => {
    const markDiscoverReviewed = vi.fn<ApiClient['markDiscoverReviewed']>(() =>
      Promise.resolve(discovering),
    );
    renderAt('/books/gull-rock/health', {
      runBookCheck: () =>
        Promise.resolve({
          envelope: { data: { checks: {}, actions: [] }, diagnostics: [] },
        } as never),
      getInteractiveStory: () =>
        Promise.resolve({
          title: book.title,
          ifid: null,
          chapters: [],
          compiled: false,
          start: null,
          nodes: [],
          variables: [],
          diagnostics: [],
        }),
      getDiscover: () =>
        Promise.resolve({
          ...discovering,
          needsReview: [beat('chapter-03', { stale: true, read: true })],
        }),
      markDiscoverReviewed,
    });
    const user = userEvent.setup();
    const threads = await screen.findByRole('list', { name: 'Open threads' });
    expect(
      within(threads)
        .getByRole('link', { name: 'Write it in Play (1 choice in)' })
        .getAttribute('href'),
    ).toBe('/books/gull-rock/branches/play?seed=1&path=0');
    await user.click(screen.getByRole('button', { name: 'Mark reviewed' }));
    expect(markDiscoverReviewed).toHaveBeenCalledWith('gull-rock', 'chapter-03');
  });
});
