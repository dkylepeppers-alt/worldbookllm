import type { Message, PresetGenerationContext } from '@worldbookllm/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PromptInspectorDialog } from './PromptInspectorDialog.js';

const context: PresetGenerationContext = {
  contextVersion: 2,
  preset: {
    id: '10000000-0000-4000-8000-000000000001',
    schemaVersion: 1,
    name: 'Captured continuity check',
    generation: { temperature: 0.25, topP: 0.8, maxTokens: 900, assistantPrefill: null },
    modules: [
      {
        key: 'rule',
        name: 'Canon rule',
        kind: 'custom',
        role: 'system',
        content: 'Never contradict the atlas.',
        enabled: true,
        insertion: { position: 'before_history' },
      },
      {
        key: 'sources',
        name: 'Sources',
        kind: 'sources',
        role: 'system',
        content: null,
        enabled: true,
        insertion: { position: 'at_depth', depth: 1 },
      },
    ],
    createdAt: '2026-07-10T12:00:00.000Z',
    updatedAt: '2026-07-10T12:00:00.000Z',
  },
  canonicalMessages: [
    { role: 'system', content: 'Never contradict the atlas.' },
    { role: 'assistant', content: 'Earlier answer' },
    { role: 'system', content: 'SOURCE: Old Coast\nAmber tide.' },
    { role: 'user', content: 'What changed?' },
  ],
  sources: [
    {
      id: 'a1c7607c-b365-438b-a7e6-31b2308464b6',
      title: 'Old Coast snapshot',
      contentHash: 'a'.repeat(64),
      content: '# Old Coast\n\nAmber tide.',
    },
  ],
  requestedControls: { temperature: 0.25, topP: 0.8, maxTokens: 900, assistantPrefill: null },
  effectiveRequestBody: {
    model: 'nano-story',
    messages: [{ role: 'system', content: 'provider converted' }],
    temperature: 0.25,
  },
  provider: 'nanogpt',
  model: 'nano-story',
};

const message: Message = {
  id: '3fdd7a3e-6d4e-4a56-a2a4-8b8a29f6d0cf',
  chatId: '60a0bf0c-031d-497c-9c1a-2f68441936a6',
  seq: 1,
  role: 'assistant',
  content: 'Answer',
  reasoning: null,
  status: 'complete',
  context,
  createdAt: '2026-07-10T12:01:05.000Z',
};

describe('PromptInspectorDialog', () => {
  it('renders every exact captured M4 section in canonical order', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<PromptInspectorDialog message={message} onClose={onClose} />);

    const dialog = screen.getByRole('dialog', { name: 'What the model received' });
    expect(within(dialog).getByText('Captured continuity check')).toBeDefined();
    expect(within(dialog).getAllByText(/Never contradict the atlas/)).toHaveLength(2);
    expect(within(dialog).getByText('Requested controls')).toBeDefined();
    const canonical = within(dialog).getByRole('list', { name: 'Canonical messages' });
    expect(
      within(canonical)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'systemNever contradict the atlas.',
      'assistantEarlier answer',
      'systemSOURCE: Old Coast\nAmber tide.',
      'userWhat changed?',
    ]);
    expect(within(dialog).getByText('Old Coast snapshot')).toBeDefined();
    expect(within(dialog).getByText('a'.repeat(64))).toBeDefined();
    expect(
      within(dialog).getByText(
        (_text, element) => element?.textContent === '# Old Coast\n\nAmber tide.',
      ),
    ).toBeDefined();
    expect(within(dialog).getByText('Effective request body')).toBeDefined();
    expect(within(dialog).getAllByText(/"temperature": 0.25/)).toHaveLength(3);
    expect(dialog.textContent).not.toContain('Authorization');
    expect(dialog.textContent).not.toContain('https://');

    await user.click(within(dialog).getByRole('button', { name: 'Close inspector' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows only recorded legacy facts and reconstruction limits', () => {
    render(
      <PromptInspectorDialog
        message={{
          ...message,
          context: {
            sourceIds: ['a1c7607c-b365-438b-a7e6-31b2308464b6'],
            provider: 'openrouter',
            model: 'legacy-model',
            strictness: 'grounded',
          },
        }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('Legacy grounded exchange')).toBeDefined();
    expect(screen.getByText('a1c7607c-b365-438b-a7e6-31b2308464b6')).toBeDefined();
    expect(screen.getByText('openrouter')).toBeDefined();
    expect(screen.getByText('legacy-model')).toBeDefined();
    expect(screen.getByText('grounded')).toBeDefined();
    expect(screen.getByText(/full prompt cannot be reconstructed/i)).toBeDefined();
  });

  it('explains when no generation context was recorded', () => {
    render(<PromptInspectorDialog message={{ ...message, context: null }} onClose={vi.fn()} />);
    expect(screen.getByText('Prompt unavailable')).toBeDefined();
    expect(screen.getByText(/no generation context was recorded/i)).toBeDefined();
  });
});
