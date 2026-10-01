import type {
  AgentChangeset,
  AgentChat,
  AgentChatDetail,
  AgentMessage,
  BookFile,
  BookSummary,
  BookTree,
  Checkpoint,
  CheckpointDetail,
  CustomAgent,
  SkillMetadata,
} from '@worldbookllm/shared';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { AppRoutes } from '../App.js';
import { ApiProvider } from '../api/ApiContext.js';
import { ApiClientError, type ApiClient } from '../api/client.js';
import { createScriptedAgentStream, createTestClient } from '../test/createTestClient.js';

const HASH = 'a'.repeat(64);
const NOW = '2026-09-30T12:00:00.000Z';
const LATER = '2026-09-30T12:05:00.000Z';
const CHAT_ID = '60a0bf0c-031d-497c-9c1a-2f68441936a6';
const CHECKPOINT_ID = '9d2f6a4e-5b1c-4f3e-8a7d-2c1b0e9f8a7d';

const book: BookSummary = {
  slug: 'the-salt-road',
  title: 'The Salt Road',
  genre: null,
  status: null,
  kind: 'book',
  seriesId: null,
  bookNumber: null,
  follows: [],
  precedes: [],
  counts: { character: 1 },
  updatedAt: NOW,
};

function file(path: string, kind: BookFile['kind'], entityId: string | null, title: string) {
  return { path, kind, entityId, title, hash: HASH, size: 10, updatedAt: NOW };
}

const tree: BookTree = {
  book,
  files: [
    file('story.md', 'story', null, 'The Salt Road'),
    file('characters/mara-quill.md', 'character', 'mara-quill', 'Mara Quill'),
  ],
};

const chat: AgentChat = {
  id: CHAT_ID,
  book: book.slug,
  title: 'Give Mara a scar',
  agentId: null,
  reviewMode: null,
  createdAt: NOW,
  updatedAt: NOW,
};

const checkpoint: Checkpoint = {
  id: CHECKPOINT_ID,
  book: book.slug,
  label: 'Agent: Give Mara a scar',
  actor: 'agent',
  createdAt: LATER,
  undoneAt: null,
  files: [{ path: 'characters/mara-quill.md', change: 'modified' }],
};

const checkpointDetail: CheckpointDetail = {
  ...checkpoint,
  files: [
    {
      path: 'characters/mara-quill.md',
      change: 'modified',
      before: '# Mara Quill\n\nSalt-grey eyes.\n',
      after: '# Mara Quill\n\nSalt-grey eyes.\nA scar across her palm.\n',
    },
  ],
};

function userMessage(seq: number, content: string): AgentMessage {
  return {
    id: `00000000-0000-4000-8000-00000000000${seq}`,
    chatId: CHAT_ID,
    seq,
    role: 'user',
    content,
    reasoning: null,
    status: 'complete',
    note: null,
    pinnedPaths: [],
    steps: [],
    checkpointId: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function assistantMessage(seq: number, overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id: `00000000-0000-4000-8000-00000000000${seq}`,
    chatId: CHAT_ID,
    seq,
    role: 'assistant',
    content: 'Added the scar.',
    reasoning: null,
    status: 'complete',
    note: null,
    pinnedPaths: [],
    steps: [
      {
        index: 0,
        requestBody: { model: 'stub-model' },
        text: '',
        toolCalls: [
          {
            id: 'c1',
            name: 'edit_file',
            arguments:
              '{"path":"characters/mara-quill.md","find":"eyes.","replace":"eyes.\\nA scar."}',
            ok: true,
            result: 'Edited characters/mara-quill.md.',
            durationMs: 12,
          },
        ],
      },
      { index: 1, requestBody: { model: 'stub-model' }, text: 'Added the scar.', toolCalls: [] },
    ],
    checkpointId: CHECKPOINT_ID,
    createdAt: NOW,
    updatedAt: LATER,
    ...overrides,
  };
}

const storySkill: SkillMetadata = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'story-plan',
  description: 'Plan a story.',
  dirPath: 'skills/story-plan',
  origin: { type: 'story-skills', package: 'story-skills@0.18.0', skillId: 'story-plan' },
  license: 'MIT',
  wordCount: 10,
  contentHash: HASH,
  createdAt: NOW,
  updatedAt: NOW,
};

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

function renderAt(path: string, overrides: Partial<ApiClient> = {}) {
  const client = createTestClient({
    listBooks: () => Promise.resolve([book]),
    getBookTree: () => Promise.resolve(tree),
    listSkills: () => Promise.resolve([storySkill]),
    ...overrides,
  });
  render(
    <ApiProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
        <LocationProbe />
      </MemoryRouter>
    </ApiProvider>,
  );
  return client;
}

describe('agent tab', () => {
  it('sits in the book tab bar and lists the book’s chats', async () => {
    renderAt('/books/the-salt-road/agent', { listAgentChats: () => Promise.resolve([chat]) });
    const tabs = await screen.findByRole('navigation', { name: 'Book' });
    expect(
      within(tabs)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Write', 'Reader', 'Bible', 'Agent', 'Health', 'Project']);
    expect(within(tabs).getByRole('link', { name: 'Agent' }).getAttribute('aria-current')).toBe(
      'page',
    );
    const list = await screen.findByRole('list', { name: 'Agent chats' });
    expect(within(list).getByRole('link', { name: 'Give Mara a scar' }).getAttribute('href')).toBe(
      `/books/the-salt-road/agent/${CHAT_ID}`,
    );
  });

  it('starts a chat, streams tool steps, and ends with a change summary', async () => {
    const stream = createScriptedAgentStream();
    const createAgentChat = vi.fn(() => Promise.resolve(chat));
    let saved: AgentChatDetail = { ...chat, changesets: [], messages: [] };
    let history: Checkpoint[] = [];
    const getBookTree = vi.fn(() => Promise.resolve(tree));
    renderAt('/books/the-salt-road/agent', {
      createAgentChat,
      getBookTree,
      getAgentChat: () => Promise.resolve(saved),
      listCheckpoints: () => Promise.resolve(history),
      streamAgentMessage: stream.streamAgentMessage,
    });

    await userEvent.type(await screen.findByLabelText('New chat'), 'Give Mara a scar');
    await userEvent.click(screen.getByRole('button', { name: 'Start chat' }));
    expect(createAgentChat).toHaveBeenCalledWith('the-salt-road', {});
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        `/books/the-salt-road/agent/${CHAT_ID}`,
      ),
    );
    expect(stream.calls).toEqual([{ chatId: CHAT_ID, content: 'Give Mara a scar' }]);
    expect(await screen.findByText('Agent · working…')).toBeDefined();

    act(() => {
      stream.emit({ type: 'step', index: 0 });
      stream.emit({
        type: 'tool_call',
        stepIndex: 0,
        id: 'c1',
        name: 'edit_file',
        arguments: '{"path":"characters/mara-quill.md","find":"eyes.","replace":"x"}',
      });
    });
    const tools = screen.getByRole('list', { name: 'Step 1 tools' });
    expect(within(tools).getByText('edit_file')).toBeDefined();
    expect(within(tools).getByText('characters/mara-quill.md')).toBeDefined();
    expect(within(tools).getByText('running…')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeDefined();

    // The server commits the checkpoint before announcing it.
    history = [checkpoint];
    act(() => {
      stream.emit({
        type: 'tool_result',
        stepIndex: 0,
        id: 'c1',
        ok: true,
        summary: 'Edited characters/mara-quill.md.',
      });
      stream.emit({ type: 'step', index: 1 });
      stream.emit({ type: 'delta', text: 'Added the scar.' });
      stream.emit({ type: 'checkpoint', checkpoint });
    });
    expect(within(tools).getByText('done')).toBeDefined();
    expect(screen.getByText('Added the scar.')).toBeDefined();
    expect(screen.getByRole('region', { name: 'Changes this turn' })).toBeDefined();

    saved = {
      ...chat,
      changesets: [],
      messages: [userMessage(0, 'Give Mara a scar'), assistantMessage(1)],
    };
    const treeLoads = getBookTree.mock.calls.length;
    act(() => stream.emit({ type: 'done', message: assistantMessage(1) }));

    expect(await screen.findByRole('button', { name: 'Undo turn' })).toBeDefined();
    expect(screen.queryByText('Agent · working…')).toBeNull();
    expect(screen.getAllByText('Give Mara a scar')).toHaveLength(2);
    expect(getBookTree.mock.calls.length).toBeGreaterThan(treeLoads);
  });

  it('opens a file diff and undoes the turn', async () => {
    const undoCheckpoint = vi.fn<ApiClient['undoCheckpoint']>(() =>
      Promise.resolve({ ...checkpoint, undoneAt: LATER }),
    );
    let history = [checkpoint];
    renderAt(`/books/the-salt-road/agent/${CHAT_ID}`, {
      getAgentChat: () =>
        Promise.resolve({
          ...chat,
          changesets: [],
          messages: [userMessage(0, 'Give Mara a scar'), assistantMessage(1)],
        }),
      listCheckpoints: () => Promise.resolve(history),
      getCheckpoint: () => Promise.resolve(checkpointDetail),
      undoCheckpoint: (slug, id) => {
        history = [{ ...checkpoint, undoneAt: LATER }];
        return undoCheckpoint(slug, id);
      },
    });

    const summary = await screen.findByRole('region', { name: 'Changes this turn' });
    await userEvent.click(within(summary).getByRole('button', { name: /characters\/mara-quill/ }));
    const dialog = await screen.findByRole('dialog');
    const lines = await within(dialog).findByRole('list', {
      name: 'Changes to characters/mara-quill.md',
    });
    expect(within(lines).getByText('A scar across her palm.').closest('li')?.className).toBe(
      'diff-add',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));

    await userEvent.click(within(summary).getByRole('button', { name: 'Undo turn' }));
    expect(undoCheckpoint).toHaveBeenCalledWith('the-salt-road', CHECKPOINT_ID);
    expect(await within(summary).findByText('Changed 1 file · undone')).toBeDefined();
  });

  it('shows the recorded steps in the inspector', async () => {
    renderAt(`/books/the-salt-road/agent/${CHAT_ID}`, {
      getAgentChat: () =>
        Promise.resolve({
          ...chat,
          changesets: [],
          messages: [userMessage(0, 'Give Mara a scar'), assistantMessage(1)],
        }),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Inspect steps' }));
    const dialog = screen.getByRole('dialog', { name: 'What the model received' });
    const steps = within(dialog).getByRole('list', { name: 'Steps' });
    expect(within(steps).getAllByRole('listitem')).toHaveLength(2);
    expect(within(dialog).getByText('edit_file · ok · 12 ms')).toBeDefined();
  });

  it('stops a turn and shows it as interrupted once the server records it', async () => {
    const stream = createScriptedAgentStream();
    let saved: AgentChatDetail = { ...chat, changesets: [], messages: [] };
    renderAt(`/books/the-salt-road/agent/${CHAT_ID}`, {
      getAgentChat: () => Promise.resolve(saved),
      streamAgentMessage: stream.streamAgentMessage,
    });
    await userEvent.type(await screen.findByLabelText('Message'), 'Draft chapter one');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    act(() => {
      stream.emit({ type: 'step', index: 0 });
      stream.emit({ type: 'delta', text: 'Once upon' });
    });

    saved = {
      ...chat,
      changesets: [],
      messages: [
        userMessage(0, 'Draft chapter one'),
        assistantMessage(1, {
          content: 'Once upon',
          status: 'interrupted',
          checkpointId: null,
          steps: [{ index: 0, requestBody: {}, text: 'Once upon', toolCalls: [] }],
        }),
      ],
    };
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(stream.active).toBe(false);
    expect(await screen.findByText('Interrupted')).toBeDefined();
    expect(screen.getByText('Once upon')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });

  it('points at provider settings and keeps the draft when the server refuses the turn', async () => {
    const stream = createScriptedAgentStream();
    renderAt(`/books/the-salt-road/agent/${CHAT_ID}`, {
      getAgentChat: () => Promise.resolve({ ...chat, changesets: [], messages: [] }),
      streamAgentMessage: stream.streamAgentMessage,
    });
    const input = await screen.findByLabelText('Message');
    await userEvent.type(input, 'Plan the book');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    act(() =>
      stream.fail(
        new ApiClientError(
          400,
          'configuration_error',
          'Configure a provider before talking to the agent.',
        ),
      ),
    );
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Configure a provider before talking to the agent.');
    expect(within(alert).getByRole('link', { name: 'Open provider settings' })).toBeDefined();
    await waitFor(() =>
      expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toBe('Plan the book'),
    );
  });

  it('opens from a file with that file pinned to the first message', async () => {
    const streamAgentMessage = vi.fn(() => new Promise<void>(() => undefined));
    renderAt('/books/the-salt-road/files/characters/mara-quill.md', {
      readBookFile: () =>
        Promise.resolve({
          ...file('characters/mara-quill.md', 'character', 'mara-quill', 'Mara Quill'),
          content: '# Mara Quill\n',
          frontmatter: null,
        }),
      createAgentChat: () => Promise.resolve(chat),
      getAgentChat: () => Promise.resolve({ ...chat, changesets: [], messages: [] }),
      streamAgentMessage,
    });
    await userEvent.click(
      await screen.findByRole('link', { name: 'Ask the agent about this file' }),
    );
    const input = await screen.findByLabelText('New chat about characters/mara-quill.md');
    expect((input as HTMLTextAreaElement).value).toBe('');
    expect(screen.getByText('Pinned file: characters/mara-quill.md')).toBeTruthy();

    await userEvent.type(input, 'Does her scar fit the timeline?');
    await userEvent.click(screen.getByRole('button', { name: 'Start chat' }));
    await waitFor(() =>
      expect(streamAgentMessage).toHaveBeenCalledWith(
        CHAT_ID,
        'Does her scar fit the timeline?',
        expect.objectContaining({ pinnedPaths: ['characters/mara-quill.md'] }),
      ),
    );
    expect(await screen.findByText('Pinned file: characters/mara-quill.md')).toBeTruthy();
  });

  it('lets the writer unpin the file before starting the chat', async () => {
    const streamAgentMessage = vi.fn(() => new Promise<void>(() => undefined));
    renderAt('/books/the-salt-road/agent?about=characters%2Fmara-quill.md', {
      createAgentChat: () => Promise.resolve(chat),
      getAgentChat: () => Promise.resolve({ ...chat, changesets: [], messages: [] }),
      streamAgentMessage,
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Unpin' }));
    expect(screen.queryByText(/Pinned file/u)).toBeNull();
    await userEvent.type(screen.getByLabelText('New chat'), 'Hello');
    await userEvent.click(screen.getByRole('button', { name: 'Start chat' }));
    await waitFor(() =>
      expect(streamAgentMessage).toHaveBeenCalledWith(
        CHAT_ID,
        'Hello',
        expect.objectContaining({ pinnedPaths: [] }),
      ),
    );
  });

  it('stops a turn running in another tab from the chat it is watching', async () => {
    let saved: AgentChatDetail = {
      ...chat,
      changesets: [],
      messages: [
        userMessage(0, 'Draft the storm'),
        assistantMessage(1, { status: 'streaming', content: '', steps: [], checkpointId: null }),
      ],
    };
    const stopAgentChat = vi.fn(() => {
      saved = {
        ...saved,
        messages: [saved.messages[0]!, { ...saved.messages[1]!, status: 'interrupted' }],
      };
      return Promise.resolve();
    });
    renderAt(`/books/the-salt-road/agent/${CHAT_ID}`, {
      getAgentChat: () => Promise.resolve(saved),
      listCheckpoints: () => Promise.resolve([]),
      stopAgentChat,
    });

    expect(
      await screen.findByText(
        'The agent is working on this chat in another tab or on another device.',
      ),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(stopAgentChat).toHaveBeenCalledWith(CHAT_ID);
    await waitFor(() =>
      expect(
        screen.queryByText(
          'The agent is working on this chat in another tab or on another device.',
        ),
      ).toBeNull(),
    );
  });

  it('offers to install Story Skills when none are installed', async () => {
    const installStorySkills = vi.fn(() =>
      Promise.resolve({ installed: [storySkill], skipped: [], upgraded: [], kept: [] }),
    );
    renderAt('/books/the-salt-road/agent', {
      listSkills: () => Promise.resolve([]),
      installStorySkills,
    });
    const notice = await screen.findByRole('region', { name: 'Story Skills' });
    await userEvent.click(within(notice).getByRole('button', { name: 'Install Story Skills' }));
    expect(installStorySkills).toHaveBeenCalled();
    expect(await within(notice).findByText('Installed 1 skill.')).toBeDefined();
    expect(within(notice).queryByRole('button', { name: 'Install Story Skills' })).toBeNull();
  });

  it('gives a new chat’s refused first message back in the chat’s composer', async () => {
    const stream = createScriptedAgentStream();
    renderAt('/books/the-salt-road/agent', {
      createAgentChat: () => Promise.resolve(chat),
      getAgentChat: () => Promise.resolve({ ...chat, changesets: [], messages: [] }),
      streamAgentMessage: stream.streamAgentMessage,
    });
    await userEvent.type(await screen.findByLabelText('New chat'), 'Plan the book');
    await userEvent.click(screen.getByRole('button', { name: 'Start chat' }));
    await screen.findByLabelText('Message');
    act(() =>
      stream.fail(new ApiClientError(400, 'configuration_error', 'Configure a provider first.')),
    );
    await waitFor(() =>
      expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toBe('Plan the book'),
    );
  });

  it('refuses a chat opened under another book', async () => {
    renderAt(`/books/the-salt-road/agent/${CHAT_ID}`, {
      getAgentChat: () =>
        Promise.resolve({ ...chat, changesets: [], book: 'other-book', messages: [] }),
    });
    expect(
      await screen.findByRole('heading', { name: 'This chat belongs to another book' }),
    ).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
  });

  it('loads a turn’s checkpoint that is older than the history page', async () => {
    const getCheckpoint = vi.fn<ApiClient['getCheckpoint']>(() =>
      Promise.resolve(checkpointDetail),
    );
    renderAt(`/books/the-salt-road/agent/${CHAT_ID}`, {
      getAgentChat: () =>
        Promise.resolve({
          ...chat,
          changesets: [],
          messages: [userMessage(0, 'Give Mara a scar'), assistantMessage(1)],
        }),
      listCheckpoints: () => Promise.resolve([]),
      getCheckpoint,
    });
    const summary = await screen.findByRole('region', { name: 'Changes this turn' });
    expect(getCheckpoint).toHaveBeenCalledWith('the-salt-road', CHECKPOINT_ID, expect.anything());
    expect(within(summary).getByText('characters/mara-quill.md')).toBeDefined();
  });

  describe('review mode', () => {
    const CHANGESET_ID = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
    const changeset: AgentChangeset = {
      id: CHANGESET_ID,
      chatId: CHAT_ID,
      messageId: assistantMessage(1).id,
      book: book.slug,
      createdAt: LATER,
      files: [
        { path: 'characters/mara-quill.md', change: 'modified', status: 'pending' },
        { path: 'research/tides.md', change: 'created', status: 'pending' },
      ],
    };
    const proposed = {
      ...chat,
      reviewMode: true,
      changesets: [changeset],
      messages: [
        userMessage(0, 'Give Mara a scar'),
        assistantMessage(1, { checkpointId: null, content: 'I propose a scar.' }),
      ],
    };

    it('applies and skips proposed files, and opens their diffs', async () => {
      const resolveAgentChangeset = vi.fn<ApiClient['resolveAgentChangeset']>(
        (_id, action, paths) =>
          Promise.resolve({
            changeset: {
              ...changeset,
              files: changeset.files.map((file) =>
                paths === undefined || paths.includes(file.path)
                  ? { ...file, status: action === 'apply' ? 'applied' : 'skipped' }
                  : file,
              ),
            },
            checkpoint: action === 'apply' ? checkpoint : null,
          }),
      );
      const getBookTree = vi.fn(() => Promise.resolve(tree));
      renderAt(`/books/the-salt-road/agent/${CHAT_ID}`, {
        getBookTree,
        getAgentChat: () => Promise.resolve(proposed),
        getAgentChangeset: () =>
          Promise.resolve({
            ...changeset,
            files: [
              {
                path: 'characters/mara-quill.md',
                change: 'modified',
                status: 'pending',
                before: '# Mara Quill\n',
                after: '# Mara Quill\n\nA scar.\n',
              },
              {
                path: 'research/tides.md',
                change: 'created',
                status: 'pending',
                before: null,
                after: '# Tides\n',
              },
            ],
          }),
        resolveAgentChangeset,
      });

      const card = await screen.findByRole('region', { name: 'Proposed changes' });
      expect(within(card).getByText('Proposed 2 changes · 2 awaiting review')).toBeDefined();
      expect(within(card).getByRole('button', { name: 'Apply all' })).toBeDefined();

      await userEvent.click(within(card).getByRole('button', { name: 'new research/tides.md' }));
      const dialog = await screen.findByRole('dialog');
      expect(
        await within(dialog).findByRole('list', { name: 'Changes to research/tides.md' }),
      ).toBeDefined();
      // Not in the book yet, so there is nothing to open.
      expect(within(dialog).queryByRole('link', { name: 'Open file' })).toBeNull();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));

      const treeLoads = getBookTree.mock.calls.length;
      await userEvent.click(
        within(card).getByRole('button', { name: 'Apply characters/mara-quill.md' }),
      );
      expect(resolveAgentChangeset).toHaveBeenCalledWith(CHANGESET_ID, 'apply', [
        'characters/mara-quill.md',
      ]);
      expect(await within(card).findByText('applied')).toBeDefined();
      await waitFor(() => expect(getBookTree.mock.calls.length).toBeGreaterThan(treeLoads));

      await userEvent.click(within(card).getByRole('button', { name: 'Skip research/tides.md' }));
      expect(resolveAgentChangeset).toHaveBeenLastCalledWith(CHANGESET_ID, 'skip', [
        'research/tides.md',
      ]);
    });

    it('offers Open file only for applied files the book still has', async () => {
      const resolvedChangeset: AgentChangeset = {
        ...changeset,
        files: changeset.files.map((file) => ({ ...file, status: 'applied' as const })),
      };
      renderAt(`/books/the-salt-road/agent/${CHAT_ID}`, {
        getAgentChat: () => Promise.resolve({ ...proposed, changesets: [resolvedChangeset] }),
        getAgentChangeset: () =>
          Promise.resolve({
            ...resolvedChangeset,
            files: resolvedChangeset.files.map((file) => ({
              ...file,
              before: null,
              after: '# File\n',
            })),
          }),
      });
      const card = await screen.findByRole('region', { name: 'Proposed changes' });
      // research/tides.md was applied, then removed: it is not in the book's tree.
      await userEvent.click(within(card).getByRole('button', { name: 'new research/tides.md' }));
      let dialog = await screen.findByRole('dialog');
      await within(dialog).findByRole('list', { name: 'Changes to research/tides.md' });
      expect(within(dialog).queryByRole('link', { name: 'Open file' })).toBeNull();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));

      await userEvent.click(
        within(card).getByRole('button', { name: 'edited characters/mara-quill.md' }),
      );
      dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByRole('link', { name: 'Open file' })).toBeDefined();
    });

    it('shows a running turn’s proposal without actions until it ends', async () => {
      const stream = createScriptedAgentStream();
      renderAt(`/books/the-salt-road/agent/${CHAT_ID}`, {
        getAgentChat: () => Promise.resolve({ ...chat, changesets: [], messages: [] }),
        streamAgentMessage: stream.streamAgentMessage,
      });
      await userEvent.type(await screen.findByLabelText('Message'), 'Propose a scar');
      await userEvent.click(screen.getByRole('button', { name: 'Send' }));
      act(() => {
        stream.emit({ type: 'step', index: 0 });
        stream.emit({ type: 'changeset', changeset });
      });
      const card = screen.getByRole('region', { name: 'Proposed changes' });
      expect(within(card).queryByRole('button', { name: /^Apply/u })).toBeNull();
      expect(within(card).getAllByText('awaiting review')).toHaveLength(2);
    });

    it('switches the chat’s agent and review mode', async () => {
      const agent: CustomAgent = {
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Continuity editor',
        description: '',
        instructions: 'Check facts.',
        skills: null,
        createdAt: NOW,
        updatedAt: NOW,
      };
      const updateAgentChat = vi.fn<ApiClient['updateAgentChat']>((_id, input) =>
        Promise.resolve({ ...chat, ...input }),
      );
      renderAt(`/books/the-salt-road/agent/${CHAT_ID}`, {
        getAgentChat: () => Promise.resolve({ ...chat, changesets: [], messages: [] }),
        listCustomAgents: () => Promise.resolve([agent]),
        updateAgentChat,
      });
      const toggle = await screen.findByRole('checkbox', {
        name: /Review changes before they apply/u,
      });
      await waitFor(() => expect((toggle as HTMLInputElement).disabled).toBe(false));
      expect((toggle as HTMLInputElement).checked).toBe(false);
      expect(screen.getByText('· from Settings')).toBeDefined();
      await userEvent.click(toggle);
      expect(updateAgentChat).toHaveBeenCalledWith(CHAT_ID, { reviewMode: true });
      await waitFor(() => expect((toggle as HTMLInputElement).checked).toBe(true));

      const select = screen.getByRole('combobox', { name: 'Agent' });
      await waitFor(() => expect((select as HTMLSelectElement).disabled).toBe(false));
      await userEvent.selectOptions(select, 'Continuity editor');
      expect(updateAgentChat).toHaveBeenLastCalledWith(CHAT_ID, { agentId: agent.id });
    });

    it('starts a chat with a chosen agent and review mode', async () => {
      const agent: CustomAgent = {
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Line editor',
        description: '',
        instructions: '',
        skills: [],
        createdAt: NOW,
        updatedAt: NOW,
      };
      const createAgentChat = vi.fn<ApiClient['createAgentChat']>(() => Promise.resolve(chat));
      renderAt('/books/the-salt-road/agent', {
        listCustomAgents: () => Promise.resolve([agent]),
        createAgentChat,
        getAgentChat: () => new Promise(() => undefined),
        streamAgentMessage: () => new Promise(() => undefined),
      });
      const select = await screen.findByRole('combobox', { name: 'Agent' });
      await screen.findByRole('option', { name: 'Line editor' });
      await userEvent.selectOptions(select, 'Line editor');
      const toggle = screen.getByRole('checkbox', { name: 'Review changes before they apply' });
      await waitFor(() => expect((toggle as HTMLInputElement).disabled).toBe(false));
      await userEvent.click(toggle);
      await userEvent.type(screen.getByLabelText('New chat'), 'Tighten chapter one');
      await userEvent.click(screen.getByRole('button', { name: 'Start chat' }));
      expect(createAgentChat).toHaveBeenCalledWith('the-salt-road', {
        agentId: agent.id,
        reviewMode: true,
      });
    });
  });
});

describe('story commands panel', () => {
  const continuity = {
    command: 'continuity' as const,
    exitCode: 1,
    envelope: {
      apiVersion: 'story/v2',
      command: 'continuity',
      ok: false,
      data: { checked: 3 },
      diagnostics: [
        {
          severity: 'error',
          file: 'characters/mara-quill.md',
          message: 'Mara is in two places in chapter 2',
          code: 'location-conflict',
          check: 'continuity',
          chapter: null,
        },
      ],
    },
  };

  it('runs a check without an agent turn and hands the result to the composer', async () => {
    localStorage.removeItem('worldbookllm.storyCommands.open');
    const runBookCheck = vi.fn(() => Promise.resolve(continuity));
    renderAt(`/books/the-salt-road/agent/${CHAT_ID}`, {
      getAgentChat: () =>
        Promise.resolve({ ...chat, messages: [], changesets: [] } satisfies AgentChatDetail),
      runBookCheck,
    });
    const user = userEvent.setup();

    const summary = await screen.findByText('Story commands', { selector: 'summary' });
    const panel = summary.closest('details');
    expect(panel?.open).toBe(false);
    await user.click(summary);
    expect(panel?.open).toBe(true);
    expect(localStorage.getItem('worldbookllm.storyCommands.open')).toBe('true');
    // A standalone book has no series links to check.
    expect(screen.queryByRole('button', { name: /^series/u })).toBeNull();

    await user.click(screen.getByRole('button', { name: /^continuity/u }));
    expect(runBookCheck).toHaveBeenCalledWith('the-salt-road', 'continuity');
    const result = await screen.findByRole('region', { name: 'story continuity result' });
    expect(within(result).getByRole('status').textContent).toContain('1 error · 0 warnings');
    // The last command is marked for sight only; the buttons are not toggles.
    const continuityButton = screen.getByRole('button', { name: /^continuity/u });
    expect(continuityButton.hasAttribute('data-last-run')).toBe(true);
    expect(continuityButton.hasAttribute('aria-pressed')).toBe(false);
    expect(
      within(result).getByRole('link', { name: 'characters/mara-quill.md' }).getAttribute('href'),
    ).toBe('/books/the-salt-road/files/characters/mara-quill.md');

    const composer = screen.getByLabelText<HTMLTextAreaElement>('Message');
    await user.type(composer, 'Before that:');
    await user.click(within(result).getByRole('button', { name: 'Ask the agent about this' }));
    expect(composer.value).toBe(
      'Before that:\n\nI ran `story continuity`: 1 error · 0 warnings.\n' +
        '- error: characters/mara-quill.md: Mara is in two places in chapter 2\n' +
        'Please fix these.',
    );
    localStorage.removeItem('worldbookllm.storyCommands.open');
  });
});
