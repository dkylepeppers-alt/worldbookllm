import type { Chat, SkillMetadata } from '@worldbookllm/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ApiProvider } from '../api/ApiContext.js';
import { createTestClient } from '../test/createTestClient.js';
import { SkillSelector } from './SkillSelector.js';

function skill(id: string, name: string): SkillMetadata {
  return {
    id,
    name,
    description: `${name} instructions`,
    dirPath: `skills/${name}`,
    origin: { type: 'created' },
    license: null,
    wordCount: 3,
    contentHash: 'a'.repeat(64),
    createdAt: '2026-07-16T12:00:00.000Z',
    updatedAt: '2026-07-16T12:00:00.000Z',
  };
}

const skills = [
  skill('11111111-1111-4111-8111-111111111111', 'character-voice'),
  skill('22222222-2222-4222-8222-222222222222', 'story-sense'),
];

const chat: Chat = {
  id: '60a0bf0c-031d-497c-9c1a-2f68441936a6',
  notebookId: 'a0c7607c-b365-438b-a7e6-31b2308464b6',
  title: 'Chat',
  sourceIds: [],
  skillIds: [],
  providerOverride: null,
  presetId: null,
  createdAt: '2026-07-16T12:00:00.000Z',
  updatedAt: '2026-07-16T12:00:00.000Z',
};

function renderSelector(selectedSkillIds: string[], updateChat = vi.fn()) {
  const client = createTestClient({
    listSkills: () => Promise.resolve(skills),
    updateChat: (id, input) => {
      updateChat(id, input);
      return Promise.resolve({ ...chat, skillIds: input.skillIds ?? [] });
    },
  });
  render(
    <ApiProvider client={client}>
      <SkillSelector chatId={chat.id} selectedSkillIds={selectedSkillIds} onChatUpdated={vi.fn()} />
    </ApiProvider>,
  );
  return { updateChat };
}

describe('SkillSelector', () => {
  it('attaches a skill by sending the complete skillIds list', async () => {
    const updateChat = vi.fn();
    renderSelector([skills[1]?.id ?? ''], updateChat);
    const user = userEvent.setup();
    await user.click(await screen.findByLabelText('character-voice'));
    await waitFor(() => expect(updateChat).toHaveBeenCalledTimes(1));
    expect(updateChat).toHaveBeenCalledWith(chat.id, {
      skillIds: skills.map((entry) => entry.id),
    });
  });

  it('detaches a skill by omitting it from the PATCH', async () => {
    const updateChat = vi.fn();
    renderSelector(
      skills.map((entry) => entry.id),
      updateChat,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByLabelText('story-sense'));
    await waitFor(() => expect(updateChat).toHaveBeenCalledTimes(1));
    expect(updateChat).toHaveBeenCalledWith(chat.id, { skillIds: [skills[0]?.id] });
  });

  it('drops a second toggle while a save is still in flight', async () => {
    const updateChat = vi.fn();
    let releaseSave = () => {};
    const client = createTestClient({
      listSkills: () => Promise.resolve(skills),
      updateChat: (id, input) => {
        updateChat(id, input);
        return new Promise((resolve) => {
          releaseSave = () => resolve({ ...chat, skillIds: input.skillIds ?? [] });
        });
      },
    });
    render(
      <ApiProvider client={client}>
        <SkillSelector chatId={chat.id} selectedSkillIds={[]} onChatUpdated={vi.fn()} />
      </ApiProvider>,
    );
    const user = userEvent.setup();
    const first = await screen.findByLabelText('character-voice');
    const second = await screen.findByLabelText('story-sense');
    // Fire both toggles in the same tick so the second lands before the
    // in-flight save resolves or the fieldset re-renders disabled.
    await Promise.all([user.click(first), user.click(second)]);
    releaseSave();
    await waitFor(() => expect(updateChat).toHaveBeenCalledTimes(1));
    expect(updateChat).toHaveBeenCalledWith(chat.id, { skillIds: [skills[0]?.id] });
  });

  it('renders nothing when the library is empty', async () => {
    const client = createTestClient({ listSkills: () => Promise.resolve([]) });
    render(
      <ApiProvider client={client}>
        <SkillSelector chatId={chat.id} selectedSkillIds={[]} onChatUpdated={vi.fn()} />
      </ApiProvider>,
    );
    await waitFor(() => expect(screen.queryByText('Craft skills')).toBeNull());
  });
});
