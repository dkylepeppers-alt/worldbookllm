---
name: verify
description: Run and verify worldbookllm end-to-end — boot the server and web UI, point them at a throwaway data dir, drive the UI with the Playwright MCP server, and run the right test commands. Use when asked to run/start the app, screenshot it, or confirm a change works in the real app rather than only in unit tests.
---

# Verifying worldbookllm end-to-end

## Boot the app

From the repo root (pnpm 9, Node ≥ 20, run `pnpm install` first if `node_modules` is missing):

```bash
pnpm dev
```

This runs both processes in parallel:

- **Server** — Fastify on http://127.0.0.1:3001 (`apps/server`, `tsx watch src/index.ts`)
- **Web UI** — Vite on http://localhost:5173 (`apps/web`); Vite proxies `/api` → `http://127.0.0.1:3001`, so always drive the app through **:5173**

There is no health-gating between the two — the web UI may come up before the server. Wait for the server's listen log (or `curl -s http://127.0.0.1:3001/api/notebooks`) before exercising API-backed flows.

To run only one side: `pnpm --filter @worldbookllm/server dev` or `pnpm --filter @worldbookllm/web dev`.

## Use a throwaway data dir

All state lives in the data dir (`apps/server/src/env.ts`: `DATA_DIR` env var, defaulting to repo-root `data/`, gitignored). Sources are `.md` files on disk (source of truth); SQLite is a rebuildable index (ADR 0003). For verification runs, isolate state:

```bash
DATA_DIR=$(mktemp -d) pnpm dev
```

The directory tree, SQLite database, and `secrets.json` are created lazily on first use. Never verify against a user's real `data/` if it has content, and never commit anything under `data/`.

## Drive the UI

The Playwright MCP server is configured in `.mcp.json`. Use `browser_navigate` to http://localhost:5173, then `browser_snapshot` / `browser_click` / `browser_type` to exercise the flow, and `browser_take_screenshot` for visual confirmation. Check `browser_console_messages` for React errors after each significant interaction.

The M1 walking-skeleton flow to exercise: create a notebook → add a pasted source → open it → (once phase 9 lands) chat against it with a configured provider.

Provider API keys are managed at runtime via the settings UI / `POST /api/secrets` and stored in `<data-dir>/secrets.json` — there is no `.env` for provider keys. Real-provider chat needs a real key; everything up to generation can be verified without one.

## Test commands

```bash
pnpm test                                     # all packages
pnpm --filter @worldbookllm/server test       # Fastify integration tests (fastify.inject)
pnpm --filter @worldbookllm/web test          # vitest + jsdom + testing-library
pnpm --filter @worldbookllm/providers test    # provider request/response unit tests
pnpm --filter @worldbookllm/shared test
```

The live-provider smoke test (`apps/server/src/generation.nanogpt.smoke.test.ts`) self-skips unless `SMOKE_NANOGPT_KEY` is set; don't expect it to run.

Before pushing, run the same gate CI runs, in order:

```bash
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build
```
