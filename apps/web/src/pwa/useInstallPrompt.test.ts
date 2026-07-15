import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useInstallPrompt } from './useInstallPrompt.js';

function fireBeforeInstallPrompt(overrides: Partial<{ prompt: () => Promise<void> }> = {}) {
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt: overrides.prompt ?? vi.fn().mockResolvedValue(undefined),
    userChoice: Promise.resolve({ outcome: 'accepted' as const }),
  });
  act(() => window.dispatchEvent(event));
  return event;
}

describe('useInstallPrompt', () => {
  it('starts with nothing to install', () => {
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.canInstall).toBe(false);
  });

  it('captures beforeinstallprompt and exposes canInstall', () => {
    const { result } = renderHook(() => useInstallPrompt());
    fireBeforeInstallPrompt();
    expect(result.current.canInstall).toBe(true);
  });

  it('prompts the captured event and clears it afterward', async () => {
    const { result } = renderHook(() => useInstallPrompt());
    const prompt = vi.fn().mockResolvedValue(undefined);
    fireBeforeInstallPrompt({ prompt });
    await act(() => result.current.promptInstall());
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(result.current.canInstall).toBe(false);
  });

  it('dismisses without prompting', () => {
    const { result } = renderHook(() => useInstallPrompt());
    const prompt = vi.fn().mockResolvedValue(undefined);
    fireBeforeInstallPrompt({ prompt });
    act(() => result.current.dismiss());
    expect(result.current.canInstall).toBe(false);
    expect(prompt).not.toHaveBeenCalled();
  });

  it('clears the prompt once the app is installed', () => {
    const { result } = renderHook(() => useInstallPrompt());
    fireBeforeInstallPrompt();
    expect(result.current.canInstall).toBe(true);
    act(() => window.dispatchEvent(new Event('appinstalled')));
    expect(result.current.canInstall).toBe(false);
  });
});
