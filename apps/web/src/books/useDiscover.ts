import type { DiscoverState } from '@worldbookllm/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { ApiClient } from '../api/client.js';
import { useApi } from '../api/useApi.js';
import { useBook } from './book-context.js';
import { errorMessage } from './useLoad.js';

/** How often the screen checks on the beat writer while it works. */
const POLL_MS = 1_500;

export interface Discover {
  /** Null until the first load; stays as last loaded while a reload runs. */
  state: DiscoverState | null;
  /** Why the last load or action failed, or null. */
  error: string | null;
  busy: boolean;
  /** Runs an action that returns the new state; false when it failed (the error is set). */
  run: (action: (api: ApiClient) => Promise<DiscoverState>) => Promise<boolean>;
  /** Whether the beat writer has a job queued or running. */
  working: boolean;
}

function activeIds(state: DiscoverState | null): string {
  return (state?.jobs ?? [])
    .filter((job) => job.status === 'queued' || job.status === 'running')
    .map((job) => job.id)
    .join(',');
}

/**
 * Discovery's state for the current book (ADR 0033). While the beat writer
 * has work queued or running it is checked every 1.5 seconds, and each time
 * a job finishes the book's files are reloaded, so Play and the map show
 * what was written.
 */
export function useDiscover(): Discover {
  const api = useApi();
  const { slug, tree, reload } = useBook();
  const [state, setState] = useState<DiscoverState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const previous = useRef('');
  const treeKey = tree.files.map((file) => file.hash).join();

  const accept = useCallback(
    (next: DiscoverState) => {
      const before = previous.current;
      const now = activeIds(next);
      previous.current = now;
      setState(next);
      // A job that was working is not anymore: what it wrote is in the book.
      if (before !== '' && before.split(',').some((id) => !now.split(',').includes(id))) reload();
    },
    [reload],
  );

  useEffect(() => {
    const controller = new AbortController();
    api.getDiscover(slug, controller.signal).then(
      (next) => {
        setError(null);
        accept(next);
      },
      (caught: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(caught));
      },
    );
    return () => controller.abort();
  }, [api, slug, treeKey, accept]);

  const working = activeIds(state) !== '';
  useEffect(() => {
    if (!working) return;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      api.getDiscover(slug, controller.signal).then(accept, () => undefined);
    }, POLL_MS);
    return () => {
      window.clearInterval(timer);
      controller.abort();
    };
  }, [api, slug, working, accept]);

  const run = useCallback(
    async (action: (client: ApiClient) => Promise<DiscoverState>) => {
      setBusy(true);
      setError(null);
      try {
        accept(await action(api));
        return true;
      } catch (caught) {
        setError(errorMessage(caught));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [api, accept],
  );

  return { state, error, busy, run, working };
}
