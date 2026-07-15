import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

const proxy = {
  '/api': process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3001',
};

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Never auto-reload out from under the user mid-edit (pwa-development
      // skill guidance): the app prompts via PwaStatusBanner instead of
      // silently swapping the service worker.
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: 'worldbookllm',
        short_name: 'Worldbook',
        description:
          'A model-agnostic creative writing and worldbuilding workspace: source-grounded AI chat over your own Markdown notebooks.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#e8e9e3',
        theme_color: '#2457c5',
        categories: ['productivity', 'utilities'],
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      includeAssets: [
        'favicon.svg',
        'icons/favicon-16x16.png',
        'icons/favicon-32x32.png',
        'icons/apple-touch-icon.png',
      ],
      workbox: {
        // This app is local-first: data lives on the user's own server, not
        // in the cloud, so there is no "sync when back online" story to
        // build (see ADR 0010). The service worker therefore precaches only
        // the static app shell (JS/CSS/fonts/icons) for instant loads and an
        // installable icon; it must never cache /api/* responses, or the UI
        // could show stale notebook/chat state while looking "online."
        navigateFallbackDenylist: [/^\/api\//],
      },
      devOptions: {
        // Keep the SW out of `pnpm dev` entirely — it only ever runs against
        // a production build, where the app shell it precaches is stable.
        enabled: false,
      },
    }),
  ],
  server: {
    proxy,
  },
  preview: {
    proxy,
  },
  test: {
    css: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
