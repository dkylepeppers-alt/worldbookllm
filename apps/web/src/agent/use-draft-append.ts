import { useState } from 'react';

import type { DraftAppend } from './AgentComposer.js';

/** Hands a story command result to the composer as draft text, and focuses it. */
export function useDraftAppend(inputId: string) {
  const [append, setAppend] = useState<DraftAppend | null>(null);
  const ask = (text: string) => {
    setAppend((previous) => ({ id: (previous?.id ?? 0) + 1, text }));
    requestAnimationFrame(() => document.getElementById(inputId)?.focus());
  };
  return { append, ask };
}
