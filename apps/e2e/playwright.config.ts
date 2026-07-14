import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));

// One throwaway data dir per run, created before the web servers launch and
// exposed to the specs so they can assert on-disk state. The ??= keeps
// re-evaluation of this module (runner and worker processes) idempotent.
process.env.WORLDBOOKLLM_E2E_DATA_DIR ??= mkdtempSync(join(tmpdir(), 'worldbookllm-e2e-'));
const dataDir = process.env.WORLDBOOKLLM_E2E_DATA_DIR;

// Off the defaults (server 3001, vite dev 5173, vite preview 4173) so a
// developer's own servers are never reused — reuse would skip this config's
// DATA_DIR isolation and API_PROXY_TARGET override.
const SERVER_PORT = 3101;
const WEB_PORT = 4273;

// Sandboxed environments with a preinstalled browser can point this at its
// chrome binary instead of downloading a build matching this Playwright
// version (e.g. WORLDBOOKLLM_E2E_CHROMIUM=/opt/pw-browsers/chromium).
const executablePath = process.env.WORLDBOOKLLM_E2E_CHROMIUM;

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  // The walking skeleton is one stateful journey against a shared server and
  // data dir; parallel workers would interleave notebook state.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  forbidOnly: !!process.env.CI,
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...(executablePath === undefined ? {} : { launchOptions: { executablePath } }),
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: [
    {
      command: 'pnpm exec tsx src/index.ts',
      cwd: join(here, '../server'),
      url: `http://127.0.0.1:${SERVER_PORT}/api/health`,
      env: { PORT: String(SERVER_PORT), HOST: '127.0.0.1', DATA_DIR: dataDir },
      timeout: 60_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `pnpm build && pnpm exec vite preview --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      cwd: join(here, '../web'),
      url: `http://127.0.0.1:${WEB_PORT}`,
      env: { API_PROXY_TARGET: `http://127.0.0.1:${SERVER_PORT}` },
      timeout: 240_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
