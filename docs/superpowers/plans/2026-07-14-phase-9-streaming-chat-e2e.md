# Phase 9 Streaming Chat and E2E Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activate the Phase 8 chat shell with streaming grounded generation — message history, POST SSE consumption, stop/reload behavior, and source selection — and finish the M1 walking-skeleton E2E.

**Architecture:** A fetch-reader SSE client parses `event:`/`data:` frames from `POST /api/chats/:id/messages` and validates each payload with the shared `streamEventSchema`; `EventSource` is not used because generation is a POST with a body and requires an `AbortSignal`. The chat panel renders persisted history from `GET /api/chats/:id`, appends an optimistic user message and an ephemeral assistant bubble during a stream, and always reconstructs from the server after `done`, `error`, or an abort. Selected sources belong to the chat and are edited via `PATCH`. The Playwright scaffold's stub provider (including its `[slow]` drip mode) completes the walking skeleton in CI; live NanoGPT verification is env-gated. Governing spec: `docs/superpowers/specs/2026-07-14-phase-9-streaming-chat-e2e-design.md`.

**Tech Stack:** React 19, React Router 7, TypeScript, Zod schemas from `@worldbookllm/shared`, react-markdown, Vitest, Testing Library, Playwright.

## Global Constraints

- `apps/web` and `apps/e2e` only; server routes, shared schemas, and `packages/providers` are frozen unless a failing E2E proves a contract defect.
- No new SPA routes; chat selection stays ephemeral panel state.
- A streaming assistant bubble is ephemeral until `done` or `error`; reload always reconstructs messages from the server.
- Secret values never appear in the client; run installs, tests, typechecks, and builds sequentially with one worker where supported.

## File Map

```text
apps/web/src/api/stream.ts               # fetch-reader SSE client (new)
apps/web/src/api/stream.test.ts          # frame parsing, unions, abort (new)
apps/web/src/chats/ChatMessages.tsx      # history + status badges (new)
apps/web/src/chats/MessageComposer.tsx   # input, send, stop (new)
apps/web/src/chats/SourceSelector.tsx    # chat sourceIds editor (new)
apps/web/src/chats/ChatPanel.tsx         # replace placeholder, wire units (modify)
apps/web/src/chats/ChatPanel.test.tsx    # streaming/stop/409 coverage (modify)
apps/web/src/test/createTestClient.ts    # scriptable stream support (modify)
apps/e2e/tests/walking-skeleton.spec.ts  # streaming steps at PHASE 9 marker (modify)
apps/e2e/tests/stop-generation.spec.ts   # [slow] stream + interrupted (new)
apps/e2e/tests/live-nanogpt.spec.ts      # real streamed exchange (modify)
```

---

### Task 1: SSE fetch-reader stream client

**Files:**

- Create: `apps/web/src/api/stream.ts`
- Test: `apps/web/src/api/stream.test.ts`

**Interfaces:**

- Produces `streamChatMessage(chatId, content, { signal, onEvent, fetchImpl? })`: POSTs the user message, parses the SSE body, validates every event with `streamEventSchema`, invokes `onEvent` per event, resolves after the terminal event or rejects on abort/malformed frames.
- Consumes `streamEventSchema` and `StreamEvent` from `@worldbookllm/shared`.

- [ ] Add failing parser tests: frames split across chunk boundaries, several events in one chunk, `delta`/`done`/`error` payloads, malformed JSON rejection, non-2xx JSON error before SSE, and abort propagation mid-stream.
- [ ] Run the focused test and confirm the module is missing.
- [ ] Implement the minimal reader loop (`fetch` + `ReadableStream` reader + `TextDecoder`, buffered frame splitting on `\n\n`).
- [ ] Run the focused test and confirm it passes.

### Task 2: Message history rendering

**Files:**

- Create: `apps/web/src/chats/ChatMessages.tsx`
- Modify: `apps/web/src/chats/ChatPanel.tsx`
- Test: `apps/web/src/chats/ChatPanel.test.tsx`

**Interfaces:**

- Produces the ordered message list for the selected chat: role labels, Markdown content, and `interrupted`/`error` status badges; replaces the Phase 9 placeholder.
- Consumes `api.getChat(chatId)` (`ChatDetail.messages`).

- [ ] Add failing panel tests: history renders in `seq` order with badges; empty chat shows an inviting empty state instead of the placeholder.
- [ ] Run the focused test and confirm it fails.
- [ ] Implement `ChatMessages` and mount it in the selected-chat detail.
- [ ] Run the focused test and confirm it passes.

### Task 3: Composer and streaming send

**Files:**

- Create: `apps/web/src/chats/MessageComposer.tsx`
- Modify: `apps/web/src/chats/ChatPanel.tsx`
- Modify: `apps/web/src/test/createTestClient.ts`
- Test: `apps/web/src/chats/ChatPanel.test.tsx`

**Interfaces:**

- Produces the message input and send flow: optimistic user message, ephemeral assistant bubble accumulating `delta` text in arrival order, `done` swapping in the persisted message, `error` showing the safe message plus `messageState`.
- Consumes `streamChatMessage` from Task 1 and a scriptable stream added to `createTestClient`.

- [ ] Add failing tests: deltas accumulate, `done` replaces the bubble, `error` adopts `messageState`, send disabled while streaming, 409 `generation_in_progress` renders inline.
- [ ] Run the focused test and confirm it fails.
- [ ] Implement the composer and panel streaming state machine.
- [ ] Run the focused test and confirm it passes.

### Task 4: Stop/abort and reload reconstruction

**Files:**

- Modify: `apps/web/src/chats/MessageComposer.tsx`
- Modify: `apps/web/src/chats/ChatPanel.tsx`
- Test: `apps/web/src/chats/ChatPanel.test.tsx`

**Interfaces:**

- Produces the Stop control: aborts the in-flight fetch, marks the bubble as stopping, refetches chat detail, and renders the persisted `interrupted` message.

- [ ] Add failing tests: Stop aborts the scripted stream, the panel refetches detail, and the `interrupted` badge renders; a network drop mid-stream also falls back to refetch.
- [ ] Run the focused test and confirm it fails.
- [ ] Implement abort wiring and post-abort refresh.
- [ ] Run the focused test and confirm it passes.

### Task 5: Source-selection controls

**Files:**

- Create: `apps/web/src/chats/SourceSelector.tsx`
- Modify: `apps/web/src/chats/ChatPanel.tsx`
- Test: `apps/web/src/chats/ChatPanel.test.tsx`

**Interfaces:**

- Produces the chat-owned source picker listing notebook sources, persisting complete-replacement `PATCH /api/chats/:id { sourceIds }`, and showing the effective selection before sending.

- [ ] Add failing tests: selection persists via PATCH, deselection sends the complete remaining list, and the selection summary renders.
- [ ] Run the focused test and confirm it fails.
- [ ] Implement the selector against workspace source state.
- [ ] Run the focused test and confirm it passes.

### Task 6: Complete the walking-skeleton E2E

**Files:**

- Modify: `apps/e2e/tests/walking-skeleton.spec.ts`
- Create: `apps/e2e/tests/stop-generation.spec.ts`
- Modify: `apps/e2e/tests/live-nanogpt.spec.ts`

**Interfaces:**

- Consumes the stub provider's `STUB_REPLY` and `[slow]` marker (`apps/e2e/stub-provider/stub-provider.ts`).

- [ ] Replace the `// PHASE 9:` placeholder assertion: select the pasted source, send a message, assert the stubbed reply streams in and the persisted message survives `page.reload()` as `complete`.
- [ ] Run the e2e suite and confirm the extended journey fails against current `main` (placeholder still rendered), then passes once Tasks 1–5 land.
- [ ] Add the stop spec: send a `[slow]` message, click Stop mid-stream, assert the reloaded message carries the `interrupted` badge.
- [ ] Extend the live NanoGPT spec with the real streamed reply-word exchange.
- [ ] Run `pnpm --filter @worldbookllm/e2e test:e2e` and confirm both stub specs pass.

### Task 7: Verification, documentation, and commit

**Files:**

- Modify: `docs/ROADMAP.md`
- Modify: `README.md`

## Verification

- [ ] **Step 1: Repository gates.**

  ```bash
  pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build
  ```

  Expected: all pass with no new warnings.

- [ ] **Step 2: Stub-provider E2E.**

  ```bash
  pnpm --filter @worldbookllm/e2e test:e2e
  ```

  Expected: walking-skeleton and stop specs pass; live spec reports skipped.

- [ ] **Step 3: Live NanoGPT gate (mandatory — a skip is not verification).**

  ```bash
  SMOKE_NANOGPT_KEY=<key> SMOKE_NANOGPT_MODEL=<model> pnpm --filter @worldbookllm/e2e test:e2e
  SMOKE_NANOGPT_KEY=<key> pnpm --filter @worldbookllm/server test
  ```

  Expected: the live specs execute (not skipped) and pass. Do not mark Phase 9 complete if any live test was skipped.

- [ ] **Step 4: Docs.** Update the ROADMAP M1 status (M1 "done when" met) and the README status section.

- [ ] **Step 5: Mark Phase 9 complete.**
