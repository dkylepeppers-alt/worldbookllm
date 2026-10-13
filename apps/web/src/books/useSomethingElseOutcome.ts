import { useEffect, useRef } from 'react';

import { useBook } from './book-context.js';
import type { Discover } from './useDiscover.js';

/**
 * Plays the reader's own action once it is a choice: when the job asked for
 * at this place (`asked`, the jobs that existed when the reader asked) is
 * accepted and the story Play runs offers the new choice. It lives with the
 * player, not the form, so a form that remounts while the story reloads
 * never loses the answer.
 */
export function useSomethingElseOutcome(input: {
  discover: Discover | null;
  asked: readonly string[] | null;
  offered: number;
  onChoose: (index: number) => void;
}) {
  const { slug } = useBook();
  const { discover, asked, offered, onChoose } = input;
  const job =
    asked === null
      ? undefined
      : discover?.state?.jobs.findLast(
          (entry) => entry.kind === 'something-else' && !asked.includes(entry.id),
        );
  const outcome = job?.status === 'done' ? job.outcome : null;
  const chosen = useRef<string | null>(null);
  useEffect(() => {
    if (discover === null || job === undefined || outcome === null || !outcome.accepted) return;
    if (chosen.current === job.id || offered <= outcome.choice) return;
    chosen.current = job.id;
    void discover.run((api) => api.dismissDiscoverJob(slug, job.id));
    onChoose(outcome.choice);
  }, [discover, job, outcome, offered, slug, onChoose]);
  return job;
}
