import type {
  AgentChat,
  AgentChatDetail,
  AgentMessage,
  BookFile,
  BookSummary,
  BookTree,
  Checkpoint,
  CheckpointDetail,
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
  seriesId: null,
  bookNumber: null,
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
    ).toEqual(['Write', 'Bible', 'Agent', 'Health', 'Project']);
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
    let saved: AgentChatDetail = { ...chat, messages: [] };
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
    expect(createAgentChat).toHaveBeenCalledWith('the-salt-road');
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
    let saved: AgentChatDetail = { ...chat, messages: [] };
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
      getAgentChat: () => Promise.resolve({ ...chat, messages: [] }),
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

  it('opens from a file with the file named in the draft', async () => {
    renderAt('/books/the-salt-road/files/characters/mara-quill.md', {
      readBookFile: () =>
        Promise.resolve({
          ...file('characters/mara-quill.md', 'character', 'mara-quill', 'Mara Quill'),
          content: '# Mara Quill\n',
          frontmatter: null,
        }),
    });
    await userEvent.click(
      await screen.findByRole('link', { name: 'Ask the agent about this file' }),
    );
    const input = await screen.findByLabelText('New chat about characters/mara-quill.md');
    expect((input as HTMLTextAreaElement).value).toBe('About characters/mara-quill.md: ');
  });

  it('offers to install Story Skills when none are installed', async () => {
    const installStorySkills = vi.fn(() =>
      Promise.resolve({ installed: [storySkill], skipped: [] }),
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
      getAgentChat: () => Promise.resolve({ ...chat, messages: [] }),
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
      getAgentChat: () => Promise.resolve({ ...chat, book: 'other-book', messages: [] }),
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
          messages: [userMessage(0, 'Give Mara a scar'), assistantMessage(1)],
        }),
      listCheckpoints: () => Promise.resolve([]),
      getCheckpoint,
    });
    const summary = await screen.findByRole('region', { name: 'Changes this turn' });
    expect(getCheckpoint).toHaveBeenCalledWith('the-salt-road', CHECKPOINT_ID, expect.anything());
    expect(within(summary).getByText('characters/mara-quill.md')).toBeDefined();
  });
});
