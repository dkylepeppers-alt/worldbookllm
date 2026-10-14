import type {
  BookFile,
  BookPlay,
  BookSummary,
  BookTree,
  DiscoverBeat,
  DiscoverJob,
  DiscoverState,
  SkillMetadata,
} from '@worldbookllm/shared';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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
    story: null,
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
    agentId: null,
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
  paused: false,
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
    const fresh: DiscoverState = {
      ...NO_DISCOVERY,
      rules: '1. Default rule.',
      writerReady: true,
      writerProblem: null,
    };
    const proposeDiscoverStory = vi.fn<ApiClient['proposeDiscoverStory']>(() =>
      Promise.resolve(fresh),
    );
    renderAt('/books/gull-rock/branches/discover', {
      getDiscover: () => Promise.resolve(fresh),
      saveDiscoverSetup,
      proposeDiscoverStory,
    });
    const user = userEvent.setup();
    const save = await screen.findByRole('button', { name: 'Save and start playing' });
    // The book has chapters, so the premise is optional: the scenes tell the beat writer the story.
    expect((save as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(/Optional: your chapters tell the story so far/u)).toBeTruthy();
    // Nothing is drafted until the writer asks, so they can pick the beat writer first.
    expect(proposeDiscoverStory).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Draft with the beat writer' }));
    await waitFor(() =>
      expect(proposeDiscoverStory).toHaveBeenCalledWith('gull-rock', {
        kernel: '',
        shape: '',
        endings: '',
        agentId: null,
      }),
    );
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

  it('needs the premise or the opening scene for a book with no chapters', async () => {
    const fresh: DiscoverState = {
      ...NO_DISCOVERY,
      rules: '1. Default rule.',
      writerReady: true,
      writerProblem: null,
    };
    const proposeDiscoverStory = vi.fn<ApiClient['proposeDiscoverStory']>(() =>
      Promise.resolve(fresh),
    );
    renderAt('/books/gull-rock/branches/discover', {
      getBookTree: () => Promise.resolve({ book, files: [] }),
      getDiscover: () => Promise.resolve(fresh),
      proposeDiscoverStory,
    });
    const user = userEvent.setup();
    const save = await screen.findByRole('button', { name: 'Save and start playing' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Write the premise, or the opening scene, first.')).toBeTruthy();
    await user.click(screen.getByLabelText('I will: here is the first scene'));
    await user.type(screen.getByLabelText(/^First scene/u), 'The keeper climbs.');
    expect((save as HTMLButtonElement).disabled).toBe(false);

    // A draft reads the scene the writer is writing.
    await user.click(screen.getByRole('button', { name: 'Draft with the beat writer' }));
    await waitFor(() =>
      expect(proposeDiscoverStory).toHaveBeenLastCalledWith('gull-rock', {
        kernel: '',
        shape: '',
        endings: '',
        opening: 'The keeper climbs.',
        agentId: null,
      }),
    );
  });

  it('fills the story fields from the beat writer, keeping what the writer typed meanwhile', async () => {
    const fresh: DiscoverState = {
      ...NO_DISCOVERY,
      rules: '1. Default rule.',
      writerReady: true,
      writerProblem: null,
    };
    let finish: (state: DiscoverState) => void = () => undefined;
    const proposeDiscoverStory = vi.fn<ApiClient['proposeDiscoverStory']>(
      () => new Promise((resolve) => (finish = resolve)),
    );
    const dismissDiscoverJob = vi.fn<ApiClient['dismissDiscoverJob']>(() => Promise.resolve(fresh));
    renderAt('/books/gull-rock/branches/discover', {
      getDiscover: () => Promise.resolve(fresh),
      proposeDiscoverStory,
      dismissDiscoverJob,
    });
    const user = userEvent.setup();
    const endings = await screen.findByLabelText('Endings');
    await user.click(screen.getByRole('button', { name: 'Draft with the beat writer' }));
    await waitFor(() => expect(proposeDiscoverStory).toHaveBeenCalled());
    await user.type(endings, 'Just one');
    finish({
      ...fresh,
      jobs: [
        job({
          kind: 'story',
          story: { kernel: 'A keeper finds a letter.', shape: 'Short and cold.', endings: 'Three' },
        }),
      ],
    });

    await waitFor(() =>
      expect((screen.getByLabelText(/^Premise/u) as HTMLTextAreaElement).value).toBe(
        'A keeper finds a letter.',
      ),
    );
    expect((screen.getByLabelText(/^Shape and tone/u) as HTMLTextAreaElement).value).toBe(
      'Short and cold.',
    );
    expect((endings as HTMLInputElement).value).toBe('Just one');
    expect(dismissDiscoverJob).toHaveBeenCalledWith(
      'gull-rock',
      '11111111-1111-4111-8111-111111111111',
    );

    // The writer can still edit what the beat writer drafted.
    await user.type(screen.getByLabelText(/^Premise/u), ' Then a storm.');
    expect((screen.getByLabelText(/^Premise/u) as HTMLTextAreaElement).value).toBe(
      'A keeper finds a letter. Then a storm.',
    );
  });

  it('stops a draft that is running', async () => {
    const fresh: DiscoverState = {
      ...NO_DISCOVERY,
      rules: '1. Default rule.',
      writerReady: true,
      writerProblem: null,
    };
    const running = { ...fresh, jobs: [job({ kind: 'story', status: 'running' })] };
    const dismissDiscoverJob = vi.fn<ApiClient['dismissDiscoverJob']>(() => Promise.resolve(fresh));
    renderAt('/books/gull-rock/branches/discover', {
      getDiscover: () => Promise.resolve(running),
      dismissDiscoverJob,
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Stop drafting' }));
    expect(dismissDiscoverJob).toHaveBeenCalledWith(
      'gull-rock',
      '11111111-1111-4111-8111-111111111111',
    );
    expect(await screen.findByRole('button', { name: 'Draft with the beat writer' })).toBeTruthy();
  });

  it('keeps unsaved changes when the writer leaves and comes back, until they discard them', async () => {
    const fresh: DiscoverState = {
      ...NO_DISCOVERY,
      rules: '1. Default rule.',
      writerReady: true,
      writerProblem: null,
    };
    const proposeDiscoverStory = vi.fn<ApiClient['proposeDiscoverStory']>(() =>
      Promise.resolve(fresh),
    );
    const overrides = { getDiscover: () => Promise.resolve(fresh), proposeDiscoverStory };
    renderAt('/books/gull-rock/branches/discover', overrides);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Endings'), 'Just one');
    expect(screen.getByText(/Not saved yet/u)).toBeTruthy();
    cleanup();

    renderAt('/books/gull-rock/branches/discover', overrides);
    const endings = await screen.findByLabelText('Endings');
    expect((endings as HTMLInputElement).value).toBe('Just one');
    // Opening the form never asks for a draft on its own.
    expect(proposeDiscoverStory).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect((endings as HTMLInputElement).value).toBe('');
    expect(screen.queryByText(/Not saved yet/u)).toBeNull();
  });

  it('adds the variables the beat writer suggests one at a time or all together', async () => {
    const suggested: DiscoverState = {
      ...discovering,
      variables: [],
      jobs: [
        job({
          kind: 'variables',
          variables: [
            { name: 'trust', initial: '0', meaning: 'How much she trusts you' },
            { name: 'knows', initial: 'false', meaning: 'Whether you read it' },
          ],
        }),
      ],
    };
    const dismissDiscoverJob = vi.fn<ApiClient['dismissDiscoverJob']>(() =>
      Promise.resolve({ ...suggested, jobs: [] }),
    );
    renderAt('/books/gull-rock/branches/discover', {
      getDiscover: () => Promise.resolve(suggested),
      dismissDiscoverJob,
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add knows' }));
    const list = screen.getByRole('list', { name: 'Variables' });
    expect(
      within(list)
        .getAllByLabelText('Name')
        .map((input) => (input as HTMLInputElement).value),
    ).toEqual(['knows']);
    expect(dismissDiscoverJob).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Add trust' }));
    expect(dismissDiscoverJob).toHaveBeenCalledWith(
      'gull-rock',
      '11111111-1111-4111-8111-111111111111',
    );
  });

  it('picks a custom agent as the beat writer, and the default when the saved one is gone', async () => {
    const agent = {
      id: '55555555-5555-4555-8555-555555555555',
      name: 'Gothic narrator',
      description: 'Dread, slowly.',
      instructions: 'Let the sea feel watchful.',
      skills: ['cold-prose', 'scene-craft', 'deleted-skill'],
      createdAt: book.updatedAt,
      updatedAt: book.updatedAt,
    };
    const skill = (name: string, origin: SkillMetadata['origin']): SkillMetadata => ({
      id:
        name === 'cold-prose'
          ? '77777777-7777-4777-8777-777777777777'
          : '88888888-8888-4888-8888-888888888888',
      name,
      description: name,
      dirPath: `skills/${name}`,
      origin,
      license: null,
      wordCount: 1,
      contentHash: 'a'.repeat(64),
      createdAt: book.updatedAt,
      updatedAt: book.updatedAt,
    });
    const saveDiscoverSetup = vi.fn<ApiClient['saveDiscoverSetup']>(() =>
      Promise.resolve(discovering),
    );
    renderAt('/books/gull-rock/branches/discover', {
      listCustomAgents: () => Promise.resolve([agent]),
      listSkills: () =>
        Promise.resolve([
          skill('cold-prose', { type: 'created' }),
          skill('scene-craft', {
            type: 'story-skills',
            package: 'story-skills@0.23.0',
            skillId: 'scene-craft',
          }),
        ]),
      saveDiscoverSetup,
    });
    const user = userEvent.setup();
    const picker = await screen.findByLabelText(/^Beat writer/u);
    await waitFor(() => expect((picker as HTMLSelectElement).disabled).toBe(false));
    await user.selectOptions(picker, 'Gothic narrator');
    expect(
      await screen.findByText(
        /Skills, followed on every beat: cold-prose\. Not used here, since Story Skills are for chats: scene-craft\. Not installed: deleted-skill\./u,
      ),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save and go to Play' }));
    await waitFor(() => expect(saveDiscoverSetup).toHaveBeenCalled());
    expect(saveDiscoverSetup.mock.calls[0]![1].setup.agentId).toBe(agent.id);
    cleanup();
    localStorage.clear();

    // The book's saved agent was deleted since.
    const gone = vi.fn<ApiClient['saveDiscoverSetup']>(() => Promise.resolve(discovering));
    renderAt('/books/gull-rock/branches/discover', {
      getDiscover: () =>
        Promise.resolve({ ...discovering, setup: { ...discovering.setup!, agentId: agent.id } }),
      listCustomAgents: () => Promise.resolve([]),
      saveDiscoverSetup: gone,
    });
    expect(await screen.findByText(/no longer exists/u)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save and go to Play' }));
    await waitFor(() => expect(gone).toHaveBeenCalled());
    expect(gone.mock.calls[0]![1].setup.agentId).toBeNull();
  });

  it('adds the Beat writer agent with its skills and picks it, before the agent list reloads', async () => {
    const beatWriter = {
      id: '66666666-6666-4666-8666-666666666666',
      name: 'Beat writer',
      description: 'Writes discovery beats with the beat writer skills.',
      instructions: 'Follow your skills on every beat.',
      skills: ['beat-shape', 'choice-design'],
      createdAt: book.updatedAt,
      updatedAt: book.updatedAt,
    };
    // The list has not caught up with the install yet when the writer saves.
    const installBeatWriter = vi.fn<ApiClient['installBeatWriter']>(() =>
      Promise.resolve({
        agent: beatWriter,
        skills: { installed: [], skipped: [], upgraded: [], kept: [] },
      }),
    );
    const saveDiscoverSetup = vi.fn<ApiClient['saveDiscoverSetup']>(() =>
      Promise.resolve(discovering),
    );
    renderAt('/books/gull-rock/branches/discover', {
      listCustomAgents: () => Promise.resolve([]),
      installBeatWriter,
      saveDiscoverSetup,
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add the Beat writer agent' }));
    expect(installBeatWriter).toHaveBeenCalled();
    const picker = screen.getByLabelText(/^Beat writer/u) as HTMLSelectElement;
    await waitFor(() => expect(picker.value).toBe(beatWriter.id));
    expect(screen.queryByRole('button', { name: 'Add the Beat writer agent' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save and go to Play' }));
    await waitFor(() => expect(saveDiscoverSetup).toHaveBeenCalled());
    expect(saveDiscoverSetup.mock.calls[0]![1].setup.agentId).toBe(beatWriter.id);
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

  it("offers Something else at every choice, shows the beat writer's reason when it declines, and lets the writer overrule it", async () => {
    const declined = job({
      kind: 'something-else',
      chapterId: 'chapter-01',
      outcome: {
        accepted: false,
        action: 'Row away',
        reason: 'There is no boat here.',
        suggestion: 'Signal the ship',
      },
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
    // The writer overrules the decline: the declined action, not the edited one, is written.
    await user.click(screen.getByRole('button', { name: 'Write it anyway' }));
    expect(somethingElse).toHaveBeenLastCalledWith('gull-rock', {
      position: { from: null, set: {}, seed: 1, path: [] },
      action: 'Row away',
      force: true,
    });
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
    // Drafting can be stopped like anything else the beat writer does.
    expect(screen.getAllByRole('button', { name: 'Stop' }).length).toBeGreaterThan(0);
  });

  it('stops the beat writer, and in lead mode resumes writing ahead when asked', async () => {
    const lead: DiscoverState = { ...discovering, setup: { ...discovering.setup!, mode: 'lead' } };
    const writing = {
      ...lead,
      jobs: [
        job({
          kind: 'beat',
          chapterId: 'chapter-02',
          title: 'Writing "Open the letter"',
          status: 'running',
        }),
      ],
    };
    const stopDiscover = vi.fn<ApiClient['stopDiscover']>(() =>
      Promise.resolve({ ...lead, paused: true }),
    );
    const resumeDiscover = vi.fn<ApiClient['resumeDiscover']>(() => Promise.resolve(lead));
    renderAt('/books/gull-rock/branches/play', {
      getDiscover: () => Promise.resolve(writing),
      setDiscoverPosition: () => Promise.resolve(writing),
      stopDiscover,
      resumeDiscover,
    });
    const user = userEvent.setup();
    expect(await screen.findByText(/Writing "Open the letter"…/u)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    expect(stopDiscover).toHaveBeenCalledWith('gull-rock');
    await user.click(await screen.findByRole('button', { name: 'Resume writing ahead' }));
    expect(resumeDiscover).toHaveBeenCalledWith('gull-rock');
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Resume writing ahead' })).toBeNull(),
    );
  });

  it('stops the beat writer while it writes the reader’s own action', async () => {
    const working = job({ kind: 'something-else', chapterId: 'chapter-01', status: 'running' });
    const stopDiscover = vi.fn<ApiClient['stopDiscover']>(() => Promise.resolve(discovering));
    renderAt('/books/gull-rock/branches/play', {
      somethingElse: () => Promise.resolve({ ...discovering, jobs: [working] }),
      stopDiscover,
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Something else…' }));
    await user.type(screen.getByLabelText('What do you do?'), 'burn it');
    await user.click(screen.getByRole('button', { name: 'Try it' }));
    expect(await screen.findByText('Writing what happens…')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    expect(stopDiscover).toHaveBeenCalledWith('gull-rock');
    await waitFor(() => expect(screen.queryByText('Writing what happens…')).toBeNull());
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

  it('offers to go on from the end of a chapter the writer wrote', async () => {
    // A converted book: discovery manages none of its chapters, so each one is the writer's.
    const converted: DiscoverState = { ...discovering, beats: [], openThreads: [] };
    const writeDiscoverBeat = vi.fn<ApiClient['writeDiscoverBeat']>(() =>
      Promise.resolve(converted),
    );
    renderAt('/books/gull-rock/branches/play?seed=1&path=1', {
      getDiscover: () => Promise.resolve(converted),
      setDiscoverPosition: () => Promise.resolve(converted),
      writeDiscoverBeat,
    });
    const user = userEvent.setup();
    expect(await screen.findByText('It curls in the flame.')).toBeTruthy();
    expect(screen.queryByText('The end.')).toBeNull();
    expect(screen.getByText(/Your chapter ends here/u)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Write what happens next' }));
    expect(writeDiscoverBeat).toHaveBeenCalledWith('gull-rock', {
      chapterId: 'chapter-03',
      position: { from: null, set: {}, seed: 1, path: [1] },
    });
  });

  it('offers no way on from a chapter whose choices this path cannot take', async () => {
    // Its choices are all conditional and closed here: they are still its choices.
    const closed: DiscoverState = {
      ...discovering,
      beats: [],
      openThreads: [],
      closingChoices: {
        ...discovering.closingChoices,
        'chapter-03': ['Read the ashes'],
      },
    };
    renderAt('/books/gull-rock/branches/play?seed=1&path=1', {
      getDiscover: () => Promise.resolve(closed),
      setDiscoverPosition: () => Promise.resolve(closed),
    });
    expect(await screen.findByText('It curls in the flame.')).toBeTruthy();
    expect(await screen.findByText('The end.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Write what happens next' })).toBeNull();
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
