# M1 Phases 6–9 Contracts-First Design

**Date:** 2026-07-10

**Status:** Approved planning strategy; contract baseline for the remaining M1 phases

**Baseline:** Phase 5 at commit `9c8788f`

## Context

Phases 6–9 finish the M1 walking skeleton: persist chats, call any configured provider, stream a source-grounded answer, and expose the complete workflow in the web application. The phases are sequentially dependent. Phase 6 defines the APIs and stream protocol; Phase 7 establishes navigation and notebook/source presentation; Phase 8 adds provider configuration; Phase 9 consumes all three foundations for streaming chat.

This document locks only the contracts and ownership boundaries that cross phase lines. Each phase still receives a detailed implementation plan immediately before implementation, using the tested output of the preceding phase. This prevents later React plans from being written against speculative server behavior while avoiding API drift between server and web work.

## M1 User Journey

The acceptance journey for the remainder of M1 is:

1. Open the application and create a notebook.
2. Paste a Markdown source and read it back from disk through the source viewer.
3. Add or select a masked provider key.
4. Configure a provider and model for the notebook, using a live or static model list and a connection test.
5. Create a chat, select one or more notebook sources, and submit a message.
6. Watch one normalized assistant response stream into the chat, stop it if desired, and see the persisted partial or complete message after reload.
7. Switch providers or models without changing source or chat data.

M1 is complete only when this journey passes against NanoGPT using the already-authorized active key and all repository verification gates pass.

## Stable Ownership Boundaries

### Shared package

`packages/shared` owns every browser/server wire schema and inferred type. Phases 6–9 must import these schemas rather than duplicate request, response, or SSE shapes. It gains chat/message, provider-operation, and stream-event schemas in Phase 6. Later phases may add UI-only types locally but do not redefine server contracts.

### Provider package

`packages/providers` remains executor-independent. It builds chat/model HTTP plans and normalizes provider response dialects, but never reads secrets, performs `fetch`, writes chat state, or emits application SSE. Phase 6 may add a provider-package normalization fix only when a failing fixture proves that an existing dialect cannot support the server flow.

### Server

`apps/server` remains the sole owner of state, secrets, provider network I/O, prompt assembly, and application SSE. The browser never receives raw keys, provider-specific request bodies, provider-specific stream chunks, or direct provider URLs assembled with credentials.

### Web

`apps/web` treats the server as its only backend. It owns navigation, user interaction, optimistic display, stream consumption, and abort controls. It does not assemble prompts, infer provider requirements, parse provider dialects, or persist application state outside ephemeral UI state.

## Cross-Phase HTTP Contracts

Existing Phase 5 notebook, source, and secret routes remain stable. Phase 6 adds the following resources for all later web phases.

### Chats

- `GET /api/notebooks/:id/chats` returns chat summaries for one notebook.
- `POST /api/notebooks/:id/chats` creates a chat with an optional title, selected source IDs, and provider override.
- `GET /api/chats/:id` returns one chat and its ordered messages.
- `PATCH /api/chats/:id` changes title, selected source IDs, and/or provider override.
- `DELETE /api/chats/:id` deletes the chat and cascades messages.
- `POST /api/chats/:id/messages` validates one user message, persists the exchange, and returns application-level SSE.

Chat provider precedence is fixed: a non-null chat override wins; otherwise the notebook provider settings apply. A chat override is a complete `ProviderConfig`, not a partial merge. Setting the override to `null` restores notebook inheritance.

Selected source IDs belong to the chat, not an individual request. Create and patch reject IDs outside the chat's notebook. Generation reads every selected source fresh from disk immediately before the provider request.

### Providers

- `GET /api/providers` returns the 26-provider catalog plus whether each provider's configured secret key currently has an active entry.
- `POST /api/providers/models` accepts provider connection fields and returns normalized models.
- `POST /api/providers/test` accepts a complete provider configuration and performs a real connection check.

The catalog includes field descriptors from `PROVIDER_META`, so Phase 8 renders provider-specific fields generically. It never contains secret values or secret IDs. Models and connection tests read only the active secret for the provider's `secretKey`.

Live-model providers test their model endpoint. Static-model providers test a minimal non-streaming completion because returning a bundled catalog does not prove credentials or connectivity. Provider failures use a stable server error shape and never echo request headers, keys, or credential-bearing URLs.

## Shared Data Contracts

### Chat

```ts
interface Chat {
  id: string;
  notebookId: string;
  title: string;
  sourceIds: string[];
  providerOverride: ProviderConfig | null;
  createdAt: string;
  updatedAt: string;
}

interface ChatDetail extends Chat {
  messages: Message[];
}
```

Chat titles default to `New chat`. M1 does not auto-title conversations. Source IDs are unique and preserve user selection order.

### Message

```ts
type MessageStatus = 'complete' | 'interrupted' | 'error';

interface GenerationContext {
  sourceIds: string[];
  provider: ProviderSource;
  model: string;
  strictness: 'grounded';
}

interface Message {
  id: string;
  chatId: string;
  seq: number;
  role: 'user' | 'assistant';
  content: string;
  reasoning: string | null;
  status: MessageStatus;
  context: GenerationContext | null;
  createdAt: string;
}
```

User messages always have `status: 'complete'`, `reasoning: null`, and `context: null`. Assistant messages snapshot the source IDs and effective provider/model. Source content remains on disk and is never copied into SQLite; M1 records which sources were selected but does not preserve historical source bodies after an out-of-band edit.

### Provider operations

Provider connection input contains `source`, optional `baseUrl`, and optional provider-specific `extra`. Complete provider config adds the required `model`. Model responses use normalized `ModelInfo[]`. Provider catalog entries contain the existing provider metadata plus `hasSecret`.

## Application SSE Protocol

The message endpoint always emits UTF-8 `text/event-stream` after request validation and generation preflight. Each event uses both an SSE event name and a JSON `data` payload with the same discriminant:

```ts
type StreamEvent =
  | { type: 'delta'; text: string; reasoning?: string }
  | { type: 'done'; message: Message }
  | {
      type: 'error';
      code: 'provider_error' | 'configuration_error' | 'internal_error';
      message: string;
      messageState: Message;
    };
```

- `delta` events contain normalized increments only; the web app appends them in arrival order.
- `done` is the only successful terminal event and contains the final persisted assistant message.
- `error` is the only failure terminal event and contains a safe message plus the persisted assistant state.
- Closing the browser request aborts the upstream provider request. No terminal event is expected on the closed connection; the partial assistant is persisted as `interrupted`.
- The server sends `Cache-Control: no-cache`, `Connection: keep-alive`, and `X-Accel-Buffering: no`.

Unknown chat, invalid input, missing source selection ownership, and absent provider configuration are rejected with ordinary JSON before SSE begins. Provider/network failures after generation starts are represented by the terminal SSE error event.

## Web Information Architecture

Phase 7 establishes these stable routes:

- `/` — notebook list and create action.
- `/notebooks/:notebookId` — notebook workspace containing source and chat regions.
- `/settings` — provider-secret management.

The notebook workspace is the long-lived composition boundary for Phases 7–9. Phase 7 implements source navigation and leaves an explicit chat region. Phase 8 adds notebook provider settings, model controls, and the minimal chat create/select shell needed to expose per-chat overrides without changing routes. Phase 9 activates that chat shell with source selection, message history, streaming, and stop behavior.

The web client uses one typed JSON client for ordinary API calls and one fetch-reader SSE client for message generation. `EventSource` is not used because generation is a POST with a request body and requires an `AbortSignal`.

## UI State and Failure Semantics

- Server responses remain authoritative after every mutation; the web client replaces optimistic placeholders with returned objects.
- Route-level loading, empty, validation-error, not-found, and retryable-server-error states are explicit.
- Secret fields are write-only. The UI displays masked server state and never caches submitted values after a request settles.
- A streaming assistant bubble is ephemeral until `done` or `error`; reload always reconstructs messages from `GET /api/chats/:id`.
- Stopping generation immediately marks the bubble as stopping, closes the fetch, and then refreshes chat detail to display the persisted `interrupted` message.
- Provider/model changes affect future exchanges only. Existing assistant context snapshots remain unchanged.

## Phase Boundaries

### Phase 6 — server contracts and generation

Implements shared schemas, chat/message persistence services and routes, provider catalog/model/test routes, prompt assembly, provider execution, application SSE, abort persistence, fake-provider integration tests, and mandatory NanoGPT live verification. It does not change the web UI.

### Phase 7 — notebook and source web foundation

Implements routing, the typed JSON API client, notebook list/create/delete/rename flows, notebook workspace shell, source paste/list/view/delete flows, and stable loading/error/empty states. It does not expose provider settings or functional chat.

### Phase 8 — provider settings and keys

Implements settings navigation, masked multi-key management, active-key rotation, generic provider field rendering, model discovery, connection tests, notebook provider defaults, and a minimal chat create/select shell for chat override editing. It does not implement messages or streaming chat.

### Phase 9 — streaming chat and E2E

Extends the Phase 8 chat shell with selected-source controls, message history, POST SSE consumption, stop/reload behavior, remaining chat-management actions, and the full walking-skeleton E2E. It makes no server-contract redesign unless a failing E2E exposes a contract defect.

## Verification Contract

Every phase runs lint, formatting, typecheck, tests, and build sequentially with workspace concurrency one. Phase 6 and Phase 9 additionally run the authorized live NanoGPT path; it must not be reported as verified when the env-gated test is skipped. Phase 9's E2E covers the complete M1 user journey and verifies persisted Markdown/SQLite state after browser reload.

Detailed UI implementation plans are written just in time: Phase 7 after Phase 6 is green, Phase 8 after Phase 7 establishes the workspace shell, and Phase 9 after Phase 8 establishes provider configuration.
