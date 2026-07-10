# Phase 6 Chat and SSE Generation Design

**Date:** 2026-07-10

**Status:** Approved by the M1 contracts-first planning decision; ready for implementation planning

**Baseline:** Phase 5 at commit `9c8788f`

## Context

Phase 5 created schema v1, notebook/source persistence, and the rotating secret store. The provider package can already build requests, parse provider SSE, normalize deltas, parse non-stream responses, and build live/static model-list plans. Phase 6 joins those pieces into the server contracts required by the remaining web phases.

The browser-facing stream must be provider-independent. All keys, prompt assembly, provider request execution, response normalization, persistence, and abort handling remain inside the server. This phase adds no UI.

## Goals

- Add shared Zod schemas and inferred types for chats, messages, provider operations, and application stream events.
- Implement chat CRUD and ordered message reads against schema v1.
- Assemble one grounded prompt from fresh source files, prior chat history, and the incoming user message.
- Execute provider chat/model requests with injected `fetch` and active secrets.
- Stream normalized application SSE and persist complete, interrupted, and error assistant messages.
- Expose provider catalog, model discovery, and connection-test routes.
- Verify all behavior against a scripted local provider plus the authorized live NanoGPT key.

## Non-goals

- React UI, browser stream consumption, or browser E2E; those begin in Phase 7 and finish in Phase 9.
- Retrieval, token budgeting, summarization, source chunking, FTS, or context-window fitting.
- Tool calls, images, citations, JSON schema output, or multiple candidates.
- Editing or regenerating existing messages.
- Auto-generated chat titles.
- Multiple simultaneous generations for one chat.
- Full Vertex service-account OAuth execution. Existing express/API-key behavior remains the M1 path.

## Architecture

Phase 6 adds four focused server units:

1. **ChatService** owns chat/message SQL, JSON mapping, source-selection validation, sequence allocation, and status updates.
2. **ProviderService** resolves metadata and active secrets, executes model-list plans, and performs connection tests.
3. **PromptAssembler** reads selected sources through `SourceService`, maps eligible chat history to provider messages, and builds the grounded system message.
4. **GenerationService** coordinates preflight, persistence, provider fetch, upstream parsing, downstream events, aborts, and the per-chat generation lock.

Routes remain thin. `buildApp()` accepts an optional `fetchImpl` in addition to `dataDir` and `logger`, constructs all services, and decorates Fastify with them. Production uses `globalThis.fetch`; tests inject a fetch implementation or point it at a scripted local HTTP server.

The server adds `@worldbookllm/providers` as a workspace runtime dependency. The existing esbuild server bundle aliases and includes both raw workspace packages while leaving third-party packages external.

## Shared Schemas

### Provider connection and config

`provider-config.ts` factors the current schema into:

```ts
const providerConnectionSchema = z.strictObject({
  source: providerSourceSchema,
  baseUrl: z.url().max(2048).optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});

const providerConfigSchema = providerConnectionSchema.extend({
  model: z.string().trim().min(1).max(256),
});
```

Existing Phase 5 notebook payloads remain wire-compatible.

### Chats and messages

`chats.ts` exports schemas/types for:

- `Chat`, `ChatDetail`, `Message`, `GenerationContext`
- create chat: optional title (default `New chat`), optional unique source IDs (default `[]`), optional provider override (default `null`)
- patch chat: optional title/source IDs/provider override with at least one supplied field
- create message: trimmed non-empty content, maximum 1 MiB

Chat titles are trimmed and limited to 200 characters. Source IDs are UUIDs, unique, and limited to 1,000 per chat. Message fields match schema v1 exactly after snake-case/JSON mapping.

`source_ids_json`, `provider_override_json`, and `context_json` are parsed with the shared schemas. Corrupt stored JSON becomes `InvalidStoredDataError`, never a client validation response.

### Provider operations

`providers.ts` exports:

- provider catalog entry and catalog response schemas
- model request/response schemas
- connection-test request/response schemas
- a normalized public `ModelInfo` schema that preserves unknown provider metadata

Catalog entries expose `source`, `label`, `family`, `secretKey`, `needsBaseUrl`, `keyOptional`, `modelSource`, `extraFields`, and `hasSecret`. Omitted optional metadata stays omitted rather than being serialized as `undefined`.

### Stream events

`stream-events.ts` exports the discriminated union from the cross-phase contract. It also exports `encodeSseEvent(event)`, producing:

```text
event: <type>\n
data: <single-line JSON>\n
\n
```

JSON serialization escapes embedded newlines, so each event always has one `data:` line.

## Chat Persistence

### Chat CRUD

Chats map directly to the existing `chats` table. List order is `updated_at DESC, id ASC`. Detail messages order by `seq ASC`.

Create and patch validate every source ID in one SQL query:

- all IDs must exist;
- every source must belong to the chat/notebook;
- duplicates are rejected by the shared schema before SQL;
- input order is preserved in `source_ids_json`.

Creating a chat requires an existing notebook. Patching or deleting a missing chat returns `404`. Deleting relies on the existing message cascade.

### Message sequence allocation

`beginExchange(chatId, content, context)` runs in one synchronous SQLite transaction:

1. Re-read the chat and effective configuration inputs.
2. Compute `nextSeq = COALESCE(MAX(seq), -1) + 1` for the chat.
3. Insert the user message at `nextSeq`, `status = complete`, and null reasoning/context.
4. Insert an empty assistant message at `nextSeq + 1`, `status = interrupted`, and the generation context snapshot.
5. Update the chat and notebook `updated_at`.

The assistant begins as `interrupted`, so a process crash cannot leave a nonexistent “pending” status. Successful completion changes it to `complete`; provider or internal generation failure changes it to `error`; client abort leaves it `interrupted` with accumulated partial content.

One in-memory per-chat lock in `GenerationService` rejects a second concurrent message request with `409 generation_in_progress`. The lock is acquired before `beginExchange` and released in `finally`. Cross-process concurrency is outside the local single-process M1 model; the unique `(chat_id, seq)` constraint remains the final guard.

## Effective Provider Configuration

Generation resolves configuration before opening SSE:

1. Load the chat and notebook.
2. Use the chat's non-null provider override, otherwise notebook settings.
3. If neither exists, throw `ConfigurationError` with `409`.
4. Look up `PROVIDER_META[source]` and read the active value for its `secretKey`.
5. If no key exists and `keyOptional` is not true, throw `ConfigurationError` without naming or exposing a value.
6. Validate required base URL and provider extras through provider-package request construction.

Provider config is a complete replacement at chat scope. Provider-specific `extra` is passed through unchanged. Secret IDs are not stored on chats, so rotating the active key affects future calls without rewriting configuration. Static model catalogs can be listed without a key; connection tests and generation still require a key unless provider metadata declares it optional.

## Prompt Assembly

Prompt assembly occurs after config/source preflight and before the exchange transaction. It receives the chat, ordered prior messages, and new user content.

The system message is deterministic:

```text
You are a creative writing and worldbuilding assistant working from user-provided source material.

## Sources
<source id="..." title="...">
...
</source>

## Grounding instructions
Treat the supplied sources as the grounding for your answer. Preserve established facts and clearly distinguish reasonable development from facts stated in the sources. If the sources do not answer something, say so rather than inventing certainty.
```

Source title attribute characters `&`, `"`, `<`, and `>` are escaped. Source bodies are inserted unchanged and in the chat's selected order. With no selected sources, the source section contains `No sources selected.`; M1 permits ungrounded conversation when the user intentionally selects none.

History follows the system message:

- include every prior user message;
- include complete assistant messages;
- include non-empty interrupted assistant messages so user-stopped text remains conversational context;
- exclude error assistant messages and empty assistant messages;
- append the incoming user message last.

M1 sends selected sources whole. There is no truncation or token estimate; provider context-limit errors flow through the normal provider error path.

## Provider Request Execution

### Shared HTTP helper

`ProviderHttpClient` accepts the injected `fetchImpl` and provides JSON and streaming execution. It applies a 30-second timeout to model-list and connection-test requests. Generation uses only the client-disconnect `AbortSignal`; providers may legitimately take longer than 30 seconds to stream.

For JSON operations it:

- serializes object bodies and sets content type when absent;
- reads response text once with a 2 MiB cap;
- parses JSON or raises a safe `ProviderError`;
- maps non-2xx responses to `ProviderError(source, status)` using a useful provider message when available;
- never places headers, keys, full credential-bearing URLs, or raw response bodies in public errors.

### Model discovery

`ProviderService.listModels(connection)` calls `buildModelListPlan`:

- return cloned static models immediately;
- execute one-request plans and parse step 0;
- for Azure's two-request plan, execute both in order and return the deployment model parsed from step 1;
- stop on the first failed request.

Results preserve provider order; the server does not add sorting that could hide provider preference.

### Connection testing

`ProviderService.testConnection(config)`:

- for `modelSource: live`, run model discovery and return `{ok: true, detail: 'Model endpoint reachable'}` when parsing succeeds;
- for `modelSource: static`, build a non-streaming chat request with one user message (`Reply with OK`), `maxTokens: 4`, and `temperature: 0`, then parse it with `parseCompletionResponse` and return `{ok: true, detail: 'Completion endpoint reachable'}`.

Optional-key providers are called without a key when none is active. CometAPI retains the provider package's pinned disabled error.

## Generation and SSE Lifecycle

`POST /api/chats/:id/messages` performs ordinary validation and generation preparation before hijacking the reply. Preparation acquires the chat lock, completes chat/config/source/prompt/request preflight without mutation, then calls `beginExchange` as its final step and returns the prepared user/assistant state. Any earlier failure releases the lock and inserts no message.

After preparation:

1. Call `reply.hijack()`, set application SSE headers, and attach one `close` listener to `reply.raw`; closing aborts the upstream controller.
2. Start provider `fetch` with the controller signal.
3. Reject a non-2xx upstream response as a provider error.
4. Parse upstream SSE events; ignore `[DONE]`, keepalives, role-only, and finish-only chunks.
5. Normalize each provider chunk. Append text/reasoning to in-memory accumulators, persist the accumulated assistant state, then emit one application `delta`.
6. On normal upstream completion after at least one text or reasoning delta, persist `complete` and emit `done` with the final row. A stream that ends without completion data is a provider error, not a successful empty assistant.
7. On provider/network/normalization failure, persist `error` and emit one safe `error` terminal event if the client is still connected.
8. On downstream close/abort, persist the accumulated assistant as `interrupted` and emit nothing further.
9. Remove listeners, release the lock, and end the response in `finally` when still writable.

Persistence occurs before each emitted delta. This favors recoverability over maximum throughput and guarantees a reload never shows less text than the browser received. SQLite writes remain synchronous and local; this can be revisited only if profiling shows it matters.

The route never forwards provider SSE event names, raw JSON, finish reasons, usage blocks, or error bodies.

## Errors and Public Status Codes

The server gains typed errors and error-handler mappings:

- `400 validation_error` — malformed request or path.
- `404 not_found` — notebook, chat, source, or secret does not exist.
- `409 configuration_error` — no effective provider/key or invalid provider configuration.
- `409 generation_in_progress` — another generation holds the chat lock.
- `502 provider_error` — a remote provider/model/test request failed before SSE.
- `500 internal_error` — corrupt stored data or unexpected server failure.

Synchronous request-plan validation errors become `409 configuration_error`; remote HTTP and response-parsing errors become `502 provider_error`. Once SSE starts, generation failures use the stream error event rather than changing HTTP status. Streamed provider failures use the fixed public message `Provider generation failed`; the detailed error is logged server-side. Unexpected errors are exposed only as `Internal server error`.

## Routes

### Chat routes

- `GET /api/notebooks/:id/chats` → `Chat[]`
- `POST /api/notebooks/:id/chats` → `201 Chat`
- `GET /api/chats/:id` → `ChatDetail`
- `PATCH /api/chats/:id` → `Chat`
- `DELETE /api/chats/:id` → `204`
- `POST /api/chats/:id/messages` → application SSE

### Provider routes

- `GET /api/providers` → `ProviderCatalogEntry[]`
- `POST /api/providers/models` → `{models: ModelInfo[]}`
- `POST /api/providers/test` → `{ok: true, detail: string}`

Provider POST routes accept only shared strict schemas. Provider errors before streaming use the public error mapping above.

## Testing Strategy

Implementation follows focused red-green cycles.

### Shared schemas

- valid/default chat creation and non-empty patches;
- duplicate/foreign-format source IDs rejected;
- row/JSON response shapes;
- provider connection vs complete config;
- every SSE variant and encoding.

### Chat and prompt services

- CRUD ordering, JSON parsing, source ownership, cascade delete;
- transactional adjacent message sequences and context snapshots;
- effective config precedence and null override inheritance;
- deterministic source order, fresh external file edits, escaping, history inclusion/exclusion, and no-source behavior;
- concurrent-generation rejection.

### Provider service

- metadata and `hasSecret` without values;
- static, one-step live, and Azure two-step model plans;
- missing required key, optional key, malformed JSON, non-2xx, timeout, and safe error text;
- live-model and static-model connection-test strategies.

### Generation integration

A scripted local HTTP server emits provider SSE in multiple chunk boundaries. A real Fastify listener is used where socket close behavior matters. Tests assert:

- normalized deltas and terminal done event;
- persisted user/assistant content, reasoning, status, sequence, and context;
- upstream non-2xx and mid-stream error persistence;
- browser abort reaches the upstream signal and leaves an interrupted partial assistant;
- reload returns exactly the persisted state;
- a second request for the same chat receives `409` while another stream is active.

### Live verification

An env-gated server smoke test exercises notebook creation, active NanoGPT secret injection, chat creation, message POST, application SSE parsing, and persisted completion. Final local verification must explicitly inject the already-authorized active NanoGPT key from the SillyTavern secret store. A skipped live test is reported as skipped, never as Phase 6 live verification.

## Memory-Safe Execution

- No parallel agents or test processes.
- Run one focused Vitest file during each red-green cycle.
- Use one scripted provider server per integration file and close it deterministically.
- Run package checks only at checkpoint boundaries.
- Run repository-wide checks sequentially with workspace concurrency one.
- Commit and push shared schemas/chat persistence, provider operations, and generation/SSE as separate recovery checkpoints.

## Acceptance Criteria

- All chat/provider routes conform to shared schemas and expose no raw secrets or provider-specific stream data.
- Chat override precedence, selected-source ownership, and fresh disk reads are deterministic.
- One message request persists adjacent user/assistant rows and a grounded context snapshot.
- Complete, provider-error, and client-abort paths persist `complete`, `error`, and `interrupted` respectively.
- Application SSE emits normalized `delta` followed by exactly one `done` or `error` terminal event while connected.
- Fake-provider integration, full repository gates, compiled-server smoke, and authorized live NanoGPT generation all pass sequentially.
