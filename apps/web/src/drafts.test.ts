import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { pruneDrafts, readDraft, useStoredDraft, writeDraft } from './drafts.js';

describe('stored drafts', () => {
  it('keeps a draft across remounts and clears it when it matches the fallback', () => {
    const first = renderHook(() => useStoredDraft('chat:a', ''));
    act(() => first.result.current[1]('Half a thought'));
    first.unmount();

    const second = renderHook(() => useStoredDraft('chat:a', ''));
    expect(second.result.current[0]).toBe('Half a thought');
    expect(second.result.current[2]).toBe(true);

    act(() => second.result.current[1](''));
    expect(readDraft('chat:a')).toBeUndefined();
    expect(second.result.current[2]).toBe(false);
  });

  it('stops calling a draft restored once it is discarded', () => {
    writeDraft('chat:c', 'Old words');
    const { result } = renderHook(() => useStoredDraft('chat:c', ''));
    expect(result.current[2]).toBe(true);
    act(() => result.current[1](''));
    act(() => result.current[1]('New words'));
    expect(result.current[2]).toBe(false);
  });

  it('loads the draft for a new key and lets an initial value win', () => {
    writeDraft('chat:b', 'For chat B');
    const { result, rerender } = renderHook(({ key }) => useStoredDraft(key, ''), {
      initialProps: { key: 'chat:a' },
    });
    expect(result.current[0]).toBe('');
    rerender({ key: 'chat:b' });
    expect(result.current[0]).toBe('For chat B');

    const handedBack = renderHook(() => useStoredDraft('chat:b', '', 'Refused message'));
    expect(handedBack.result.current[0]).toBe('Refused message');
  });

  it('drops drafts older than 30 days', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      writeDraft('old', 'stale');
      writeDraft('read-later', 'stale too');
      vi.setSystemTime(new Date('2026-02-15T00:00:00Z'));
      writeDraft('fresh', 'recent');
      pruneDrafts();
      expect(localStorage.getItem('worldbookllm.draft.old')).toBeNull();
      expect(readDraft('read-later')).toBeUndefined();
      expect(readDraft('fresh')).toBe('recent');
    } finally {
      vi.useRealTimers();
    }
  });
});
