import { useCallback, useEffect, useEffectEvent, useState } from 'react';

import { ApiClientError } from '../api/client.js';

export type LoadState<T> =
  { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; message: string };

export function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  return error instanceof Error ? error.message : 'Something went wrong.';
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * Loads data for a screen whenever `key` changes, aborting the previous
 * request, and exposes `reload` for after a write. While a reload runs the
 * last good data stays on screen.
 */
export function useLoad<T>(
  load: (signal: AbortSignal) => Promise<T>,
  key: string,
): LoadState<T> & { reload: () => void } {
  const [state, setState] = useState<LoadState<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  const run = useEffectEvent((signal: AbortSignal) => load(signal));

  useEffect(() => {
    const controller = new AbortController();
    run(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ status: 'ready', data });
      },
      (error: unknown) => {
        if (!isAbort(error) && !controller.signal.aborted) {
          setState({ status: 'error', message: errorMessage(error) });
        }
      },
    );
    return () => controller.abort();
  }, [key, attempt]);

  return { ...state, reload };
}
