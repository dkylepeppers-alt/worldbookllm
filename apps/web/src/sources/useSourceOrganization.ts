import type { SourceOrganizationDraft, SourceOrganizationResponse } from '@worldbookllm/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useApi } from '../api/useApi.js';

export function useSourceOrganization(notebookId: string) {
  const api = useApi();
  const active = useRef<{ controller: AbortController; sequence: number } | null>(null);
  const sequence = useRef(0);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<SourceOrganizationResponse | null>(null);

  const cancel = useCallback(() => {
    active.current?.controller.abort();
    active.current = null;
    setLoading(false);
  }, []);

  const suggest = useCallback(
    async (drafts: SourceOrganizationDraft[]) => {
      active.current?.controller.abort();
      const controller = new AbortController();
      const current = ++sequence.current;
      active.current = { controller, sequence: current };
      setLoading(true);
      try {
        const result = await api.suggestSourceOrganization(
          notebookId,
          { drafts },
          controller.signal,
        );
        // A superseded call must not leak its result: callers apply what
        // `suggest` resolves with, so a stale response becomes null.
        if (active.current?.sequence !== current) return null;
        setResponse(result);
        return result;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return null;
        if (active.current?.sequence !== current) return null;
        const fallback: SourceOrganizationResponse = {
          suggestions: drafts.map(({ index }) => ({ index, category: null, tags: [] })),
          warning: "Couldn't suggest organization. You can choose it manually.",
        };
        setResponse(fallback);
        return fallback;
      } finally {
        if (active.current?.sequence === current) {
          active.current = null;
          setLoading(false);
        }
      }
    },
    [api, notebookId],
  );

  useEffect(() => cancel, [cancel]);
  return { loading, response, suggest, cancel };
}
