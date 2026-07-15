import { type RefObject, useEffect, useLayoutEffect, useRef } from 'react';

export function useDialogLifecycle(
  initialFocusRef: RefObject<HTMLElement | null>,
  onClose: () => void,
): void {
  const closeRef = useRef(onClose);
  useLayoutEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const inertState = new Map<HTMLElement, boolean>();
    let current = initialFocusRef.current?.closest<HTMLElement>('[role="dialog"]') ?? null;
    while (current !== null && current !== document.body && current.parentElement !== null) {
      const parent = current.parentElement;
      for (const sibling of Array.from(parent.children)) {
        if (!(sibling instanceof HTMLElement) || sibling === current) continue;
        inertState.set(sibling, sibling.hasAttribute('inert'));
        sibling.setAttribute('inert', '');
      }
      current = parent;
    }
    initialFocusRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      const dialog = initialFocusRef.current?.closest<HTMLElement>('[role="dialog"]');
      const modalDialogs = Array.from(
        document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'),
      );
      if (dialog === undefined || dialog === null || modalDialogs.at(-1) !== dialog) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (
        event.shiftKey &&
        (document.activeElement === first || !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        first?.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      for (const [element, wasInert] of inertState) {
        if (!wasInert) element.removeAttribute('inert');
      }
      previousFocus?.focus();
    };
  }, [initialFocusRef]);
}
