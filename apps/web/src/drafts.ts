import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

/**
 * Unsent and unsaved text, kept in this browser's localStorage so it survives
 * switching tabs, leaving a page, or the browser discarding a backgrounded
 * app. Drafts stay on this device; the server never sees them until the
 * writer sends or saves. Never store secrets here.
 */
const PREFIX = 'worldbookllm.draft.';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

interface StoredDraft {
  value: unknown;
  savedAt: number;
}

function parse(raw: string | null): StoredDraft | null {
  if (raw === null) return null;
  try {
    const stored = JSON.parse(raw) as Partial<StoredDraft>;
    if (typeof stored.savedAt !== 'number' || !('value' in stored)) return null;
    return { value: stored.value, savedAt: stored.savedAt };
  } catch {
    return null;
  }
}

/** The draft saved under `key`, or undefined when there is none (or it expired). */
export function readDraft<T>(key: string): T | undefined {
  try {
    const stored = parse(localStorage.getItem(PREFIX + key));
    if (stored === null) return undefined;
    if (Date.now() - stored.savedAt > MAX_AGE_MS) {
      localStorage.removeItem(PREFIX + key);
      return undefined;
    }
    return stored.value as T;
  } catch {
    return undefined;
  }
}

export function writeDraft(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ value, savedAt: Date.now() }));
  } catch {
    // Keeping a draft is a convenience; a full or blocked storage loses only that.
  }
}

export function clearDraft(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    // As above.
  }
}

/** Drops drafts nobody came back to within 30 days. */
export function pruneDrafts(): void {
  try {
    const now = Date.now();
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key === null || !key.startsWith(PREFIX)) continue;
      const stored = parse(localStorage.getItem(key));
      if (stored === null || now - stored.savedAt > MAX_AGE_MS) localStorage.removeItem(key);
    }
  } catch {
    // As above.
  }
}

interface DraftState<T> {
  key: string;
  value: T;
  restored: boolean;
}

function load<T>(key: string, fallback: T, initial: T | undefined): DraftState<T> {
  if (initial !== undefined) return { key, value: initial, restored: false };
  const stored = readDraft<T>(key);
  return stored === undefined
    ? { key, value: fallback, restored: false }
    : { key, value: stored, restored: true };
}

/**
 * `useState` for a draft that persists under `key`. A value equal to
 * `fallback` (the saved or empty state) clears the stored draft. When `key`
 * changes, the draft for the new key is loaded. `initial`, when given, wins
 * over a stored draft at load (e.g. a message the server handed back).
 * `restored` says whether the current value came from storage and still
 * differs from `fallback`.
 */
export function useStoredDraft<T>(
  key: string,
  fallback: T,
  initial?: T,
): [T, Dispatch<SetStateAction<T>>, boolean] {
  const [state, setState] = useState(() => load(key, fallback, initial));
  let current = state;
  if (state.key !== key) {
    // Adjusting state during render, so a new key never shows the old draft.
    current = load(key, fallback, undefined);
    setState(current);
  }

  const fallbackJson = JSON.stringify(fallback);
  const valueJson = JSON.stringify(current.value);
  const fallbackRef = useRef(fallbackJson);
  useEffect(() => {
    fallbackRef.current = fallbackJson;
  }, [fallbackJson]);
  useEffect(() => {
    if (valueJson === fallbackJson) clearDraft(key);
    else writeDraft(key, JSON.parse(valueJson));
  }, [key, valueJson, fallbackJson]);

  const setValue = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    setState((previous) => {
      const value = typeof next === 'function' ? (next as (value: T) => T)(previous.value) : next;
      // Once a restored draft is discarded, later typing is new, not restored.
      const restored = previous.restored && JSON.stringify(value) !== fallbackRef.current;
      return { ...previous, value, restored };
    });
  }, []);

  return [current.value, setValue, current.restored && valueJson !== fallbackJson];
}
