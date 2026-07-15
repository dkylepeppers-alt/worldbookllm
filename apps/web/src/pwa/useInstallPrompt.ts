import { useCallback, useEffect, useState } from 'react';

// Not yet in TypeScript's DOM lib; minimal shape of the event Chromium-based
// browsers fire when the page qualifies for installation.
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface InstallPrompt {
  /** True once the browser has offered an install prompt to capture. */
  canInstall: boolean;
  /** Shows the captured native install prompt. */
  promptInstall: () => Promise<void>;
  /** Hides the affordance for this page session without prompting. */
  dismiss: () => void;
}

/**
 * Captures the browser's `beforeinstallprompt` event so the app can offer its
 * own "Install" affordance instead of relying on browser chrome alone.
 * Firefox and Safari never fire this event — `canInstall` simply stays
 * false there, which is the correct, honest state (nothing to install via
 * this API on those browsers).
 */
export function useInstallPrompt(): InstallPrompt {
  const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    function onBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setDeferredEvent(event as BeforeInstallPromptEvent);
    }
    function onInstalled() {
      setDeferredEvent(null);
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferredEvent) return;
    await deferredEvent.prompt();
    await deferredEvent.userChoice;
    // Each event is single-use whether accepted or dismissed.
    setDeferredEvent(null);
  }, [deferredEvent]);

  const dismiss = useCallback(() => setDeferredEvent(null), []);

  return { canInstall: deferredEvent !== null, promptInstall, dismiss };
}
