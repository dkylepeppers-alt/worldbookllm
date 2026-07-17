import type { SourceOrganizationResponse } from '@worldbookllm/shared';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ApiProvider } from '../api/ApiContext.js';
import type { ApiClient } from '../api/client.js';
import { createTestClient } from '../test/createTestClient.js';
import { useSourceOrganization } from './useSourceOrganization.js';

const notebook = { id: 'a0c7607c-b365-438b-a7e6-31b2308464b6' };

function apiWrapper(client: ApiClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <ApiProvider client={client}>{children}</ApiProvider>;
  };
}

describe('useSourceOrganization', () => {
  it('keeps only the newest suggestion response and aborts on unmount', async () => {
    const resolvers: Array<(value: SourceOrganizationResponse) => void> = [];
    const suggestSourceOrganization = vi.fn(
      (_notebookId, _input, signal?: AbortSignal) =>
        new Promise<SourceOrganizationResponse>((resolve, reject) => {
          signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
          resolvers.push(resolve);
        }),
    );
    const { result, unmount } = renderHook(() => useSourceOrganization(notebook.id), {
      wrapper: apiWrapper(createTestClient({ suggestSourceOrganization })),
    });
    act(() => void result.current.suggest([{ index: 0, title: 'First', content: 'One' }]));
    act(() => void result.current.suggest([{ index: 0, title: 'Second', content: 'Two' }]));
    await act(async () =>
      resolvers[1]?.({
        suggestions: [{ index: 0, category: 'lore', tags: ['second'] }],
        warning: null,
      }),
    );
    await act(async () =>
      resolvers[0]?.({
        suggestions: [{ index: 0, category: 'misc', tags: ['first'] }],
        warning: null,
      }),
    );
    expect(result.current.response?.suggestions[0]?.tags).toEqual(['second']);
    act(() => void result.current.suggest([{ index: 0, title: 'Third', content: 'Three' }]));
    const pendingSignal = suggestSourceOrganization.mock.calls.at(-1)?.[2];
    unmount();
    expect(pendingSignal?.aborted).toBe(true);
  });
});
