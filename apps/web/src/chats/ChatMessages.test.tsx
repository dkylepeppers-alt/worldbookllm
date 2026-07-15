import type { Message } from '@worldbookllm/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ChatMessages } from './ChatMessages.js';

const base: Message = {
  id: '3fdd7a3e-6d4e-4a56-a2a4-8b8a29f6d0cf',
  chatId: '60a0bf0c-031d-497c-9c1a-2f68441936a6',
  seq: 0,
  role: 'assistant',
  content: 'Recorded answer',
  reasoning: null,
  status: 'complete',
  context: null,
  createdAt: '2026-07-10T12:01:05.000Z',
};

describe('ChatMessages response actions', () => {
  it('shows both actions for every persisted nonempty assistant status', async () => {
    const messages: Message[] = (['complete', 'interrupted', 'error'] as const).map(
      (status, index) => ({
        ...base,
        id: `${index + 1}fdd7a3e-6d4e-4a56-a2a4-8b8a29f6d0c${index}`,
        seq: index,
        status,
      }),
    );
    const inspect = vi.fn();
    const capture = vi.fn();
    const user = userEvent.setup();
    render(
      <ChatMessages
        messages={messages}
        pending={null}
        onInspect={inspect}
        onAddToSources={capture}
      />,
    );

    expect(screen.getAllByRole('button', { name: 'Inspect prompt' })).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: 'Add to sources' })).toHaveLength(3);
    await user.click(screen.getAllByRole('button', { name: 'Inspect prompt' })[1]!);
    await user.click(screen.getAllByRole('button', { name: 'Add to sources' })[2]!);
    expect(inspect).toHaveBeenCalledWith(messages[1]);
    expect(capture).toHaveBeenCalledWith(messages[2]);
  });

  it('omits actions for users, whitespace-only assistants, and the pending exchange', () => {
    render(
      <ChatMessages
        messages={[
          { ...base, role: 'user', content: 'Question' },
          { ...base, id: '4fdd7a3e-6d4e-4a56-a2a4-8b8a29f6d0cf', seq: 1, content: ' \n ' },
        ]}
        pending={{
          userContent: 'Pending question',
          assistantText: 'Pending answer',
          stopping: false,
        }}
        onInspect={vi.fn()}
        onAddToSources={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Inspect prompt' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add to sources' })).toBeNull();
    expect(
      within(screen.getByRole('list', { name: 'Messages' })).getByText('Pending answer'),
    ).toBeDefined();
  });
});
