import { useRef } from 'react';

import { useDialogLifecycle } from './useDialogLifecycle.js';

interface ConfirmDialogProps {
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  busy = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useDialogLifecycle(cancelRef, () => {
    if (!busy) onCancel();
  });

  return (
    <div className="dialog-backdrop">
      <section
        className="dialog-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
      >
        <p className="coordinate-label">Confirm action</p>
        <h2 id="confirm-dialog-title">{title}</h2>
        <div className="dialog-copy">{children}</div>
        <div className="dialog-actions">
          <button ref={cancelRef} type="button" className="button-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="button-danger" disabled={busy} onClick={onConfirm}>
            {busy ? 'Deleting…' : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
