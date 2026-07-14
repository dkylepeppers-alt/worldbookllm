# Phase 9 Streaming Chat and E2E Design

**Date:** 2026-07-14

**Status:** Ready for implementation planning; conforms to the M1 phases 6–9 contract baseline

**Baseline:** Phase 8 merged to `main` at commit `29e7ee2`, plus the Playwright walking-skeleton scaffold (`apps/e2e`) with its stub OpenAI-compatible provider

## Context

Phases 6–8 delivered the streaming server contract, the notebook/source workspace, and provider configuration with a chat shell. The shell renders an explicit placeholder where messages belong. Phase 9 activates it — journey steps 5 and 6 of the M1 acceptance journey — and finishes the walking-skeleton E2E that the scaffold already runs through phase 8 against the stub provider.

## Scope

`apps/web` and `apps/e2e` only. The server SSE protocol, shared `StreamEvent` schemas, and chat routes are frozen; Phase 9 makes no server-contract redesign unless a failing E2E exposes a contract defect (per the contracts spec).

Out of scope: retrieval or token budgeting, message editing/regeneration, auto-titling, reasoning display beyond plain text, and any new SPA routes — chat selection remains ephemeral panel state.

## New Web Units

1. **SSE stream client** — `apps/web/src/api/stream.ts`. A fetch-reader client for `POST /api/chats/:id/messages`: sends the user message, reads the response body with a `ReadableStream` reader + `TextDecoder`, reassembles `event:`/`data:` frames across chunk boundaries, validates every payload with `streamEventSchema` from `@worldbookllm/shared`, and invokes an `onEvent` callback per event. `EventSource` is not used: generation is a POST with a body and requires an `AbortSignal`.
2. **Message history** — `apps/web/src/chats/ChatMessages.tsx`. Renders `ChatDetail.messages` in `seq` order: role, Markdown content, and status badges for `interrupted` and `error` assistant messages. Reload always reconstructs from `GET /api/chats/:id`.
3. **Composer and streaming bubble** — `apps/web/src/chats/MessageComposer.tsx` plus `ChatPanel` integration. Submitting appends an optimistic user message and an ephemeral assistant bubble that accumulates `delta` text in arrival order. `done` replaces the bubble with the persisted message; `error` shows the safe message and adopts `messageState`. Send is disabled while a stream is in flight; a server 409 (`generation only runs one at a time`) renders inline.
4. **Stop control** — a Stop button aborts the fetch via `AbortController`, marks the bubble as stopping, then refetches chat detail to display the persisted `interrupted` message. No terminal event is expected on an aborted connection.
5. **Source selection** — `apps/web/src/chats/SourceSelector.tsx`. Chat-owned selected sources edited via `PATCH /api/chats/:id { sourceIds }` (complete replacement, notebook-owned IDs only); the effective selection is visible before sending.

## E2E Completion

The scaffold's `apps/e2e/tests/walking-skeleton.spec.ts` carries a `// PHASE 9:` marker in the create-chat step. Phase 9 replaces the placeholder assertion with: select the pasted source, send a message, watch the stubbed reply stream into the bubble, and assert the persisted `complete` assistant message — including after `page.reload()`. A second spec exercises Stop using the stub's `[slow]` marker (slow delta drip) and asserts the reloaded message is `interrupted`. `apps/e2e/tests/live-nanogpt.spec.ts` gains the real streamed exchange (reply-word contract, mirroring the server smoke test).

## Testing Strategy

- **Stream client (vitest):** hand-built `ReadableStream` fixtures — frames split across chunks, multiple events per chunk, `delta`/`done`/`error` unions, malformed payload rejection, and abort propagation.
- **Chat UI (vitest + testing-library):** extend `createTestClient` with a scriptable stream; test optimistic append, delta accumulation, done/error terminal handling, stop flow, 409 display, and source-selection editing, following the existing `ChatPanel.test.tsx` patterns.
- **E2E (Playwright):** the completed walking skeleton and stop spec against the stub provider in CI; the live NanoGPT spec env-gated.

## Verification

Repository gates run sequentially: `lint`, `format:check`, `typecheck`, `test`, `build`, then `pnpm --filter @worldbookllm/e2e test:e2e`. Phase 9 sign-off additionally requires the authorized live NanoGPT paths to actually run — `SMOKE_NANOGPT_KEY=… pnpm --filter @worldbookllm/e2e test:e2e` and `SMOKE_NANOGPT_KEY=… pnpm --filter @worldbookllm/server test` — and they must not be reported as verified when the env-gated tests are skipped.

## Acceptance Criteria

- A chat with selected sources streams one normalized assistant response into the panel, and the persisted message renders identically after reload.
- Stopping mid-stream closes the request immediately and the reloaded chat shows the partial message with an `interrupted` badge.
- Provider errors after generation starts surface the safe message and the persisted `error` state; validation and 409 failures render inline before any stream begins.
- Selected source IDs are edited on the chat (complete replacement), rejected for foreign notebooks by the existing server contract, and visibly inform the next exchange.
- Send is unavailable while a generation is in flight; switching providers or models never mutates existing messages or context snapshots.
- The full M1 walking-skeleton E2E — including streaming, stop, reload, and on-disk state — passes against the stub provider in CI, and the live NanoGPT specs pass when run with the operator's key.
- No new server routes, SPA routes, or shared-schema changes; all repository gates pass.
