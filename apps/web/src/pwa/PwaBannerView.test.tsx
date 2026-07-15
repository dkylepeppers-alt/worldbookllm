import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PwaBannerView } from './PwaBannerView.js';

function renderView(overrides: Partial<Parameters<typeof PwaBannerView>[0]> = {}) {
  const props = {
    needRefresh: false,
    onReload: vi.fn(),
    onDismissRefresh: vi.fn(),
    offlineReady: false,
    onDismissOfflineReady: vi.fn(),
    canInstall: false,
    onInstall: vi.fn(),
    onDismissInstall: vi.fn(),
    ...overrides,
  };
  const { container } = render(<PwaBannerView {...props} />);
  return { container, props };
}

describe('PwaBannerView', () => {
  it('renders nothing when there is no update, offline-ready, or install signal', () => {
    const { container } = renderView();
    expect(container.firstChild).toBeNull();
  });

  it('shows an update prompt and reloads or dismisses on demand', async () => {
    const { props } = renderView({ needRefresh: true });
    expect(screen.getByText('A new version of worldbookllm is ready.')).toBeTruthy();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    expect(props.onReload).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Later' }));
    expect(props.onDismissRefresh).toHaveBeenCalledTimes(1);
  });

  it('shows the offline-ready toast and dismisses it', async () => {
    const { props } = renderView({ offlineReady: true });
    expect(screen.getByText(/ready to load instantly/)).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(props.onDismissOfflineReady).toHaveBeenCalledTimes(1);
  });

  it('shows the install affordance and installs or dismisses on demand', async () => {
    const { props } = renderView({ canInstall: true });
    expect(screen.getByText(/Add worldbookllm to your device/)).toBeTruthy();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Install' }));
    expect(props.onInstall).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    expect(props.onDismissInstall).toHaveBeenCalledTimes(1);
  });

  it('can show the update, offline-ready, and install cards together', () => {
    renderView({ needRefresh: true, offlineReady: true, canInstall: true });
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Install' })).toBeTruthy();
  });
});
