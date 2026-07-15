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

describe('ChatMessages thinking, swipes, and regenerate', () => {
  it('renders reasoning collapsed behind a Thinking disclosure', () => {
    render(
      <ChatMessages messages={[{ ...base, reasoning: 'Weighing the options' }]} pending={null} />,
    );
    const disclosure = screen.getByText('Thinking').closest('details');
    expect(disclosure).not.toBeNull();
    expect(disclosure?.open).toBe(false);
    expect(screen.getByText('Weighing the options')).toBeTruthy();
  });

  it('shows Regenerate only on the last assistant message', () => {
    const messages: Message[] = [
      { ...base, id: '11111111-1111-4111-8111-111111111111', seq: 0, content: 'First' },
      { ...base, id: '22222222-2222-4222-8222-222222222222', seq: 1, content: 'Second' },
    ];
    render(<ChatMessages messages={messages} pending={null} onRegenerate={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: 'Regenerate' })).toHaveLength(1);
  });

  it('pages between variants through onSelectVariant', async () => {
    const message: Message = {
      ...base,
      content: 'Second',
      activeVariant: 1,
      variants: [
        {
          content: 'First',
          reasoning: null,
          status: 'complete',
          context: null,
          createdAt: base.createdAt,
        },
        {
          content: 'Second',
          reasoning: null,
          status: 'complete',
          context: null,
          createdAt: base.createdAt,
        },
      ],
    };
    const onSelectVariant = vi.fn();
    const user = userEvent.setup();
    render(<ChatMessages messages={[message]} pending={null} onSelectVariant={onSelectVariant} />);
    expect(screen.getByText('2/2')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next response' })).toHaveProperty('disabled', true);
    await user.click(screen.getByRole('button', { name: 'Previous response' }));
    expect(onSelectVariant).toHaveBeenCalledWith(message, 0);
  });

  it('streams a regenerating response over the target message', () => {
    render(
      <ChatMessages
        messages={[base]}
        pending={null}
        regenStream={{ messageId: base.id, text: 'New draft', reasoning: '', stopping: false }}
      />,
    );
    expect(screen.getByText('New draft')).toBeTruthy();
    expect(screen.queryByText('Recorded answer')).toBeNull();
  });
});

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
          assistantReasoning: '',
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
