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

The M1 walking-skeleton flow to exercise: create a notebook → add a pasted source → open it → chat against it with a configured provider.

Provider API keys are managed at runtime via the settings UI / `POST /api/secrets` and stored in `<data-dir>/secrets.json` — there is no `.env` for provider keys. Real-provider chat needs a real key; everything up to generation can be verified without one.

## M2 ingestion journey

Use deterministic checked-in fixtures for Markdown, text, PDF, and HTML. Do not verify conversion against a public website: serve the HTML fixture from a controlled local HTTP server that exercises the same guarded URL-fetch path.

Drive this complete flow:

1. Create a notebook and upload the PDF setting-bible fixture.
2. Wait for conversion, inspect the origin and conversion notes, edit a deliberately mangled table in the Markdown review, and save.
3. Import the controlled HTML fixture by URL, review the conversion, and save it.
4. Edit a saved source and confirm the same source ID now returns the revised Markdown.
5. Delete one imported source, re-ingest it, review again, and save. For replacement re-ingestion, verify a failed or cancelled preview leaves the current source unchanged.
6. Chat with the converted source selected and confirm the grounded response uses its reviewed content.

After UI verification, inspect the throwaway data directory:

- every saved source is readable frontmattered Markdown;
- origin metadata and conversion notes are present in the file and SQLite index;
- reviewed edits, hashes, word counts, slugs, and timestamps agree;
- no cancelled preview created a source;
- no converter temporary files or orphaned old source paths remain.

Also check browser console messages and server logs after conversion failures. Exercise malformed/unsupported upload and blocked URL cases in integration tests rather than attempting unsafe network destinations during browser verification.

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
