import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { describe, expect, it } from 'vitest';

import { useDialogLifecycle } from './useDialogLifecycle.js';

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open dialog
      </button>
      {open ? <Dialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function Dialog({ onClose }: { onClose: () => void }) {
  const firstRef = useRef<HTMLButtonElement>(null);
  useDialogLifecycle(firstRef, onClose);
  return (
    <section role="dialog" aria-modal="true" aria-label="Test dialog">
      <button ref={firstRef} type="button">
        First
      </button>
      <a href="/schema">Schema</a>
      <button type="button" onClick={onClose}>
        Last
      </button>
    </section>
  );
}

describe('useDialogLifecycle', () => {
  it('contains forward and reverse tab focus and restores the opener on close', async () => {
    render(<Harness />);
    const user = userEvent.setup();
    const opener = screen.getByRole('button', { name: 'Open dialog' });
    await user.click(opener);
    expect(opener.hasAttribute('inert')).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'First' }));

    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Last' }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'First' }));

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(opener);
  });
});
