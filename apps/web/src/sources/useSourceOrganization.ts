import type {
  ExistingSourceOrganizationResponse,
  SourceOrganizationDraft,
  SourceOrganizationResponse,
} from '@worldbookllm/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useApi } from '../api/useApi.js';

const ORGANIZATION_WARNING = "Couldn't suggest organization. You can choose it manually.";

/**
 * Shared request lifecycle for organization suggestions: one attempt at a
 * time, superseded or aborted attempts never leak their result, and any
 * failure resolves to the caller-provided manual-organization fallback.
 */
function useOrganizationSuggestions<Input, Response>(
  perform: (input: Input, signal: AbortSignal) => Promise<Response>,
  fallbackFor: (input: Input) => Response,
) {
  const active = useRef<{ controller: AbortController; sequence: number } | null>(null);
  const sequence = useRef(0);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<Response | null>(null);

  const cancel = useCallback(() => {
    active.current?.controller.abort();
    active.current = null;
    setLoading(false);
  }, []);

  const suggest = useCallback(
    async (input: Input) => {
      active.current?.controller.abort();
      const controller = new AbortController();
      const current = ++sequence.current;
      active.current = { controller, sequence: current };
      setLoading(true);
      try {
        const result = await perform(input, controller.signal);
        // A superseded call must not leak its result: callers apply what
        // `suggest` resolves with, so a stale response becomes null.
        if (active.current?.sequence !== current) return null;
        setResponse(result);
        return result;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return null;
        if (active.current?.sequence !== current) return null;
        const fallback = fallbackFor(input);
        setResponse(fallback);
        return fallback;
      } finally {
        if (active.current?.sequence === current) {
          active.current = null;
          setLoading(false);
        }
      }
    },
    [perform, fallbackFor],
  );

  useEffect(() => cancel, [cancel]);
  return { loading, response, suggest, cancel };
}

export function useSourceOrganization(notebookId: string) {
  const api = useApi();
  return useOrganizationSuggestions<SourceOrganizationDraft[], SourceOrganizationResponse>(
    useCallback(
      (drafts, signal) => api.suggestSourceOrganization(notebookId, { drafts }, signal),
      [api, notebookId],
    ),
    useCallback(
      (drafts) => ({
        suggestions: drafts.map(({ index }) => ({ index, category: null, tags: [] })),
        warning: ORGANIZATION_WARNING,
      }),
      [],
    ),
  );
}

/** Suggestions for sources already saved in the notebook, keyed by source id. */
export function useExistingSourceOrganization(notebookId: string) {
  const api = useApi();
  return useOrganizationSuggestions<string[], ExistingSourceOrganizationResponse>(
    useCallback(
      (sourceIds, signal) =>
        api.suggestExistingSourceOrganization(notebookId, { sourceIds }, signal),
      [api, notebookId],
    ),
    useCallback(
      (sourceIds) => ({
        suggestions: sourceIds.map((sourceId) => ({ sourceId, category: null, tags: [] })),
        warning: ORGANIZATION_WARNING,
      }),
      [],
    ),
  );
}
