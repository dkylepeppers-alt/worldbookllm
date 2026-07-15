# ADR 0010 — Installable PWA, served single-origin in production

**Status:** accepted · 2026-07-15

## Context

ADR 0002 already committed to "the frontend is a static bundle the server serves in production — one process, one port, SillyTavern-style," but the server never actually served `apps/web/dist`: production deployment meant running two processes (the API server and a separate static host for the built SPA) with no documented story for wiring them together. Separately, the product's original intent was a first-class installable app — but no web app manifest, icons, or service worker ever existed; the app was online-only with no install affordance (a plain `P0` per the `pwa-development` skill's diagnostic framework: "No manifest.json, no service worker, online-only").

Both gaps compound each other: a proper PWA install (`beforeinstallprompt`, "Add to Home Screen") and a stable service-worker scope both want the app and its API on the same origin, and a local-first tool that already expects the user to run one process on their own machine is exactly the shape that benefits most from being a single, installable, app-like window rather than a browser tab pointed at a dev-style two-process setup.

## Decision

1. **Fulfill ADR 0002 as written.** `apps/server` serves `apps/web/dist` directly when it exists (`WEB_DIST_DIR`, default resolved next to the server bundle), with an SPA fallback (`index.html`) for client-side routes, and continues to return the existing JSON 404 shape for unmatched `/api/*` paths. This is skipped whenever the web app hasn't been built (dev, most tests), so it adds no burden to local development.
2. **Make the app installable**, via `vite-plugin-pwa`: a web app manifest (`display: standalone`, Field Atlas colors/icons), a generated icon set (`apps/web/src/brand/mark.svg` → PNGs via `apps/web/scripts/generate-icons.mjs`), and a generated service worker that precaches the static app shell only.
3. **Scope "offline" deliberately, per the skill's core warning** ("PWAs fail when offline behavior is an afterthought"): this app is local-first — a notebook's real state lives in the user's own SQLite database and Markdown files, served by their own local server. There is no cloud backend to sync against while offline, so there is no offline data-mutation queue (no IndexedDB write queue, no Background Sync). The service worker precaches only the static shell (JS/CSS/fonts/icons) for instant loads and a stable installable icon; it explicitly never caches `/api/*` (`workbox.navigateFallbackDenylist`), so the UI can never show stale notebook/chat state while looking connected. If the local server is down, the shell still loads and the UI can say so plainly — it does not pretend to work.
4. **Never force a silent reload.** `registerType: 'prompt'` plus a custom `PwaStatusBanner` (not the plugin's default UI) — the user approves picking up a new service-worker version rather than losing in-progress work to a silent tab reload.

## Rationale

- One process, one port removes an entire class of production deployment questions (reverse-proxying two origins, CORS, cookie/storage partitioning) for a tool whose target user already just wants to run a command and open a browser.
- Same-origin API + app is also what makes the service worker and manifest coherent: `start_url`/`scope` and the SW's registration scope match the one origin the user actually installs.
- Hand-rolled icons (one SVG source, a small `sharp` script) were chosen over an automated asset-generation plugin (`@vite-pwa/assets-generator`) so the exact maskable safe-zone geometry and brand mark are under direct control and easy to reason about, rather than depending on an additional tool's defaults.

## Consequences

- `apps/server` gains `@fastify/static` and a `WEB_DIST_DIR` env var; `apps/web` gains `vite-plugin-pwa`, `workbox-window`, and `sharp` (icon-generation only, not shipped to the browser).
- Rebranding requires re-running `pnpm --filter @worldbookllm/web generate:icons` after editing `src/brand/mark.svg`, then committing the regenerated PNGs.
- No offline editing/sync is supported or planned by this decision; if that ever becomes a goal, it is a new architectural decision (IndexedDB queue, conflict resolution, Background Sync), not an incremental addition to this service worker.
