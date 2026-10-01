import type { SkillDetail } from '@worldbookllm/shared';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { AppRoutes } from '../App.js';
import { ApiProvider } from '../api/ApiContext.js';
import type { ApiClient } from '../api/client.js';
import { createTestClient } from '../test/createTestClient.js';

const NOW = '2026-09-30T12:00:00.000Z';

const plan: SkillDetail = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'story-plan',
  description: 'Plans a story.',
  dirPath: 'skills/story-plan',
  origin: { type: 'created' },
  license: null,
  wordCount: 3,
  contentHash: 'a'.repeat(64),
  createdAt: NOW,
  updatedAt: NOW,
  content: '# Plan\n',
};

function renderSkills(overrides: Partial<ApiClient> = {}) {
  const client = createTestClient({
    listSkills: () => Promise.resolve([plan]),
    getSkill: () => Promise.resolve(plan),
    ...overrides,
  });
  render(
    <ApiProvider client={client}>
      <MemoryRouter initialEntries={['/skills']}>
        <AppRoutes />
      </MemoryRouter>
    </ApiProvider>,
  );
}

describe('skills page', () => {
  it('reopens the skill being edited with its unsaved changes, until they are saved', async () => {
    const updateSkill = vi.fn<ApiClient['updateSkill']>(() => Promise.resolve(plan));
    renderSkills({ updateSkill });
    await userEvent.click(await screen.findByRole('button', { name: /story-plan/u }));
    await userEvent.type(await screen.findByLabelText('Instructions (Markdown)'), 'Acts.');
    cleanup();

    renderSkills({ updateSkill });
    const content = await screen.findByLabelText<HTMLTextAreaElement>('Instructions (Markdown)');
    expect(content.value).toBe('# Plan\nActs.');
    expect(screen.getByText(/unsaved changes were restored/u)).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(updateSkill).toHaveBeenCalledWith(plan.id, {
      name: 'story-plan',
      description: 'Plans a story.',
      content: '# Plan\nActs.',
    });
    expect(localStorage.getItem(`worldbookllm.draft.skill:${plan.id}`)).toBeNull();
  });

  it('keeps a new skill’s draft after leaving the page', async () => {
    renderSkills();
    await userEvent.click(await screen.findByRole('button', { name: 'New skill' }));
    await userEvent.type(screen.getByLabelText('Description'), 'Checks tides.');
    cleanup();

    renderSkills();
    expect((await screen.findByLabelText<HTMLTextAreaElement>('Description')).value).toBe(
      'Checks tides.',
    );
    expect(screen.getByText(/unsaved changes were restored/u)).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Description')).toBeNull();
    expect(localStorage.getItem('worldbookllm.draft.skill:new')).toBeNull();
  });
});
