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

There is no health-gating between the two — the web UI may come up before the server. Wait for the server's listen log (or `curl -s http://127.0.0.1:3001/api/health`) before exercising API-backed flows.

To run only one side: `pnpm --filter @worldbookllm/server dev` or `pnpm --filter @worldbookllm/web dev`.

## Use a throwaway data dir

All state lives in the data dir (`apps/server/src/env.ts`: `DATA_DIR` env var, defaulting to repo-root `data/`, gitignored). Books are `.md` files on disk under `projects/` (source of truth); SQLite is a rebuildable index (ADR 0003, ADR 0014). For verification runs, isolate state:

```bash
DATA_DIR=$(mktemp -d) pnpm dev
```

The directory tree, SQLite database, and `secrets.json` are created lazily on first use. Never verify against a user's real `data/` if it has content, and never commit anything under `data/`.

## Drive the UI

The Playwright MCP server is configured in `.mcp.json`. Use `browser_navigate` to http://localhost:5173, then `browser_snapshot` / `browser_click` / `browser_type` to exercise the flow, and `browser_take_screenshot` for visual confirmation. Check `browser_console_messages` for React errors after each significant interaction. In a sandbox without a Chrome install, drive `/opt/pw-browsers/chromium` from a Playwright script instead, or run the e2e suite with `WORLDBOOKLLM_E2E_CHROMIUM=/opt/pw-browsers/chromium`.

The core flow to exercise: create a book → add a character or import a pasted note → open the Agent tab with a configured provider → install Story Skills → ask the agent for a change → review the change summary and undo it.

Provider API keys are managed at runtime via the settings UI / `POST /api/secrets` and stored in `<data-dir>/secrets.json` — there is no `.env` for provider keys. Real-provider chat needs a real key; everything up to generation can be verified without one.

## Ingestion journey

Use deterministic checked-in fixtures for Markdown, text, PDF, and HTML. Drive this flow in a book:

1. Import the PDF setting-bible fixture, inspect the origin and conversion notes, fix a deliberately mangled table in the review, and save.
2. Import a SillyTavern character card and confirm it is suggested as a `character`.
3. Undo the import from the book's history and confirm the files are gone.

After UI verification, inspect the throwaway data directory: every imported file is readable frontmattered Markdown with flat `origin-*` and `imported-at` keys, `story validate` passes, and no converter temporary files remain.

## Notebook migration

A data dir from before ADR 0017 migrates when the server starts: each notebook becomes a book under `projects/`, its sources research notes and its chats agent chats, and `notebooks/` is renamed to `notebooks.migrated/`. The library shows the report until dismissed. `apps/server/src/notebook-migration.test.ts` seeds such a data dir directly.

## Test commands

```bash
pnpm test                                     # all packages
pnpm --filter @worldbookllm/server test       # Fastify integration tests (fastify.inject)
pnpm --filter @worldbookllm/web test          # vitest + jsdom + testing-library
pnpm --filter @worldbookllm/providers test    # provider request/response unit tests
pnpm --filter @worldbookllm/shared test
```

Browser journeys: `WORLDBOOKLLM_E2E_CHROMIUM=/opt/pw-browsers/chromium CI=1 pnpm --filter @worldbookllm/e2e test:e2e`. The live NanoGPT journey (`apps/e2e/tests/live-nanogpt.spec.ts`) self-skips unless `SMOKE_NANOGPT_KEY` is set; don't expect it to run.

Before pushing, run the same gate CI runs, in order:

```bash
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build
```
