import type { CustomAgent, SkillMetadata } from '@worldbookllm/shared';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { AppRoutes } from '../App.js';
import { ApiProvider } from '../api/ApiContext.js';
import type { ApiClient } from '../api/client.js';
import { createTestClient } from '../test/createTestClient.js';

const NOW = '2026-09-30T12:00:00.000Z';

function skill(name: string): SkillMetadata {
  return {
    id: `00000000-0000-4000-8000-${name === 'story-plan' ? '000000000001' : '000000000002'}`,
    name,
    description: `The ${name} skill.`,
    dirPath: `skills/${name}`,
    origin: { type: 'created' },
    license: null,
    wordCount: 10,
    contentHash: 'a'.repeat(64),
    createdAt: NOW,
    updatedAt: NOW,
  };
}

const saved: CustomAgent = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Continuity editor',
  description: 'Checks canon.',
  instructions: 'Check facts against the bible.',
  skills: ['story-plan'],
  createdAt: NOW,
  updatedAt: NOW,
};

function renderAgents(overrides: Partial<ApiClient>) {
  const client = createTestClient({
    listSkills: () => Promise.resolve([skill('story-plan'), skill('story-voice')]),
    ...overrides,
  });
  render(
    <ApiProvider client={client}>
      <MemoryRouter initialEntries={['/agents']}>
        <AppRoutes />
      </MemoryRouter>
    </ApiProvider>,
  );
}

describe('agents page', () => {
  it('creates an agent limited to chosen skills', async () => {
    let agents: CustomAgent[] = [];
    const createCustomAgent = vi.fn<ApiClient['createCustomAgent']>((input) => {
      const created = {
        ...saved,
        id: '33333333-3333-4333-8333-333333333333',
        name: input.name,
        description: input.description ?? '',
        instructions: input.instructions ?? '',
        skills: input.skills ?? null,
      };
      agents = [created];
      return Promise.resolve(created);
    });
    renderAgents({ listCustomAgents: () => Promise.resolve(agents), createCustomAgent });

    expect(await screen.findByText(/No custom agents yet/u)).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'New agent' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Line editor');
    await userEvent.type(screen.getByLabelText('Instructions'), 'Tighten prose only.');
    await userEvent.click(screen.getByRole('radio', { name: 'Only the skills chosen below' }));
    const chosen = screen.getByRole('list', { name: 'Chosen skills' });
    await userEvent.click(within(chosen).getByRole('checkbox', { name: /story-voice/u }));
    await userEvent.click(screen.getByRole('button', { name: 'Create agent' }));

    expect(createCustomAgent).toHaveBeenCalledWith({
      name: 'Line editor',
      description: '',
      instructions: 'Tighten prose only.',
      skills: ['story-voice'],
    });
    const list = await screen.findByRole('region', { name: 'Saved agents' });
    expect(await within(list).findByText('Line editor')).toBeDefined();
    expect(within(list).getByText('1 skill')).toBeDefined();
  });

  it('edits and deletes a saved agent', async () => {
    const updateCustomAgent = vi.fn<ApiClient['updateCustomAgent']>((_id, input) =>
      Promise.resolve({ ...saved, ...input }),
    );
    const deleteCustomAgent = vi.fn(() => Promise.resolve());
    renderAgents({
      listCustomAgents: () => Promise.resolve([saved]),
      updateCustomAgent,
      deleteCustomAgent,
    });
    await userEvent.click(await screen.findByRole('button', { name: /Continuity editor/u }));
    await userEvent.click(screen.getByRole('radio', { name: 'Every installed skill' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(updateCustomAgent).toHaveBeenCalledWith(saved.id, {
      name: 'Continuity editor',
      description: 'Checks canon.',
      instructions: 'Check facts against the bible.',
      skills: null,
    });

    await userEvent.click(screen.getByRole('button', { name: 'Delete agent' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete agent' }));
    await waitFor(() => expect(deleteCustomAgent).toHaveBeenCalledWith(saved.id));
  });

  it('reopens the agent being edited with its unsaved changes after leaving the page', async () => {
    const overrides = { listCustomAgents: () => Promise.resolve([saved]) };
    renderAgents(overrides);
    await userEvent.click(await screen.findByRole('button', { name: /Continuity editor/u }));
    await userEvent.type(screen.getByLabelText('Instructions'), ' Quote the page.');
    cleanup();

    renderAgents(overrides);
    const instructions = await screen.findByLabelText<HTMLTextAreaElement>('Instructions');
    expect(instructions.value).toBe('Check facts against the bible. Quote the page.');
    await userEvent.click(screen.getByRole('button', { name: 'Discard them' }));
    expect(instructions.value).toBe('Check facts against the bible.');
    expect(screen.queryByText(/unsaved changes were restored/u)).toBeNull();
  });

  it('keeps nothing after a save, even when the server trims the input', async () => {
    let current = saved;
    const updateCustomAgent = vi.fn<ApiClient['updateCustomAgent']>((_id, input) => {
      current = { ...saved, ...input, updatedAt: '2026-09-30T13:00:00.000Z' };
      return Promise.resolve(current);
    });
    renderAgents({ listCustomAgents: () => Promise.resolve([current]), updateCustomAgent });
    await userEvent.click(await screen.findByRole('button', { name: /Continuity editor/u }));
    await userEvent.type(screen.getByLabelText('Name'), '  ');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(updateCustomAgent).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByLabelText<HTMLInputElement>('Name').value).toBe('Continuity editor'),
    );
    expect(localStorage.getItem(`worldbookllm.draft.agent:${saved.id}`)).toBeNull();
  });
});
