import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PwaStatusBanner } from './PwaStatusBanner.js';

describe('PwaStatusBanner', () => {
  it('wires up without crashing and renders nothing absent any PWA signal', () => {
    // virtual:pwa-register/react resolves to vite-plugin-pwa's dev no-op
    // stub outside a real build (devOptions.enabled is false in
    // vite.config.ts), so needRefresh/offlineReady are always false here.
    const { container } = render(<PwaStatusBanner />);
    expect(container.firstChild).toBeNull();
  });
});
