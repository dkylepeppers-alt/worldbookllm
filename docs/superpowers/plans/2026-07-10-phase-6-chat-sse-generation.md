# Phase 6 Chat and SSE Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add durable chat/message APIs, provider catalog/model/test APIs, grounded prompt assembly, normalized application SSE generation, abort persistence, and live NanoGPT verification to the server.

**Architecture:** Shared Zod schemas define every server/web contract. Focused chat, prompt, provider, and generation services coordinate the existing SQLite/source/secret primitives and pure provider package; Fastify routes remain transport adapters. Generation is split into synchronous preflight plus an async stream session so ordinary errors occur before SSE and all streamed states are persisted.

**Tech Stack:** TypeScript 5.9, Fastify 5, Zod 4, better-sqlite3 11.10, Node 20 fetch/streams, Vitest 3, `@worldbookllm/providers`

## Global Constraints

- Source Markdown files remain truth; generation reads selected sources fresh and never stores source bodies in SQLite.
- Provider keys remain server-only and are read from the active secret entry at call time.
- Browser SSE is `delta | done | error`; provider-specific chunks never cross the server boundary.
- A chat override completely replaces notebook provider settings; `null` restores inheritance.
- M1 strictness is exactly `grounded`; no retrieval, token budgeting, tools, media, or UI work enters Phase 6.
- One chat permits only one active generation in the local single-process server.
- Execute inline without subagents or parallel test processes because the environment is memory-constrained.
- All new behavior follows red-green-refactor with focused Vitest files.
- Run tests/checks sequentially with workspace concurrency one and push every completed checkpoint.
- Final local verification must run the authorized NanoGPT test with a key injected; a skipped test is not live verification.

---

## File Map

```text
packages/shared/src/
  provider-config.ts              factor connection fields from complete config
  chats.ts                        Chat, Message, request, and context schemas
  providers.ts                    provider catalog/model/test wire schemas
  stream-events.ts                application SSE union and encoder
  phase6-schemas.test.ts          shared boundary tests
  index.ts                        public exports

apps/server/src/
  errors.ts                       configuration/conflict error classes
  services/chats.ts               chat/message persistence and source ownership
  services/chats.test.ts          CRUD, sequencing, corruption, and cascade tests
  services/prompt-assembler.ts    grounded system/history/source messages
  services/prompt-assembler.test.ts deterministic fresh-source prompt tests
  providers/http-client.ts        safe JSON/stream fetch execution
  providers/http-client.test.ts   response caps, timeouts, and sanitized errors
  services/providers.ts           catalog, models, connection tests, chat plans
  services/providers.test.ts      static/live/two-step/key strategy tests
  services/generation.ts          lock, preflight, normalization, persistence
  services/generation.test.ts     fake-provider completion/error/abort tests
  routes/chats.ts                 chat CRUD and message SSE routes
  routes/providers.ts             catalog/model/test routes
  app.ts                          construct/decorate Phase 6 services, inject fetch
  app.test.ts                     route contract integration
  generation.nanogpt.smoke.test.ts authorized live server path
```

### Task 1: Shared Phase 6 Contracts

**Files:**

- Create: `packages/shared/src/chats.ts`
- Create: `packages/shared/src/providers.ts`
- Create: `packages/shared/src/stream-events.ts`
- Create: `packages/shared/src/phase6-schemas.test.ts`
- Modify: `packages/shared/src/provider-config.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**

- Produces `providerConnectionSchema`, `chatSchema`, `chatDetailSchema`, `messageSchema`, `generationContextSchema`, create/patch/message schemas, provider operation schemas, `streamEventSchema`, and `encodeSseEvent()`.
- Existing `ProviderConfig` and notebook payloads remain wire-compatible.

- [ ] **Step 1: Write failing provider/chat schema tests**

```ts
expect(providerConnectionSchema.parse({ source: 'nanogpt' })).toEqual({ source: 'nanogpt' });
expect(providerConfigSchema.parse({ source: 'nanogpt', model: 'gpt-4o-mini' })).toEqual({
  source: 'nanogpt',
  model: 'gpt-4o-mini',
});
expect(createChatSchema.parse({})).toEqual({
  title: 'New chat',
  sourceIds: [],
  providerOverride: null,
});
expect(() => createChatSchema.parse({ sourceIds: [SOURCE_ID, SOURCE_ID] })).toThrow();
expect(() => patchChatSchema.parse({})).toThrow();
```

Add complete fixtures for `Chat`, `ChatDetail`, user/assistant `Message`, generation context, provider catalog, model response, and connection-test response.

Run: `pnpm --filter @worldbookllm/shared test -- phase6-schemas.test.ts`

Expected: FAIL because Phase 6 schemas are not exported.

- [ ] **Step 2: Refactor provider config without changing its output**

```ts
export const providerConnectionSchema = z.strictObject({
  source: providerSourceSchema,
  baseUrl: z.url().max(2048).optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});

export const providerConfigSchema = providerConnectionSchema.extend({
  model: z.string().trim().min(1).max(256),
});
```

Retain `ProviderSource`/`ProviderConfig` and add `ProviderConnection`.

- [ ] **Step 3: Implement chat and message schemas**

```ts
export const generationContextSchema = z.strictObject({
  sourceIds: z.array(z.uuid()).max(1_000),
  provider: providerSourceSchema,
  model: z.string().min(1).max(256),
  strictness: z.literal('grounded'),
});

export const messageSchema = z.strictObject({
  id: z.uuid(),
  chatId: z.uuid(),
  seq: z.number().int().nonnegative(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  reasoning: z.string().nullable(),
  status: z.enum(['complete', 'interrupted', 'error']),
  context: generationContextSchema.nullable(),
  createdAt: z.iso.datetime(),
});
```

Create strict chat/detail schemas. Use a reusable unique UUID array with max 1,000. Default create fields exactly as tested. Message input is trimmed, non-empty, and max 1 MiB. Patch requires at least one supplied field.

- [ ] **Step 4: Implement provider operation and SSE schemas**

Define provider catalog metadata including generic `extraFields`, `hasSecret`, normalized model information with `.catchall(z.unknown())`, `{models}`, and `{ok: literal(true), detail}` responses.

```ts
export function encodeSseEvent(event: StreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
```

The error stream event requires `code`, safe `message`, and persisted `messageState`.

- [ ] **Step 5: Run shared verification**

```bash
pnpm --filter @worldbookllm/shared test -- phase6-schemas.test.ts
pnpm --filter @worldbookllm/shared typecheck
```

Expected: all Phase 6 schema tests PASS and TypeScript exits 0.

- [ ] **Step 6: Commit and push**

```bash
git add packages/shared/src
git commit -m "feat(shared): add chat provider and SSE contracts"
git push origin main
```

### Task 2: Chat and Message Persistence

**Files:**

- Create: `apps/server/src/services/chats.ts`
- Create: `apps/server/src/services/chats.test.ts`
- Modify: `apps/server/src/errors.ts`

**Interfaces:**

- Produces `ChatService.list/create/get/getDetail/patch/delete`, `getHistory`, `beginExchange`, and `updateAssistant`.
- Produces `ConfigurationError` and `ConflictError`, each with a stable public code.

- [ ] **Step 1: Write failing chat CRUD and ownership tests**

Use `openDatabase(tempDir)` plus a real `SourceFileStore` and existing notebook/source services. Create two notebooks and sources, then assert:

```ts
const chat = chats.create(notebook.id, {
  title: 'Continuity',
  sourceIds: [ownSource.id],
  providerOverride: null,
});
expect(chats.getDetail(chat.id)).toEqual({ ...chat, messages: [] });
expect(() => chats.patch(chat.id, { sourceIds: [otherNotebookSource.id] })).toThrow(NotFoundError);
```

Also pin list ordering, complete override replacement, `null` inheritance, missing resources, malformed stored JSON becoming `InvalidStoredDataError`, and cascade deletion.

Run: `pnpm --filter @worldbookllm/server test -- src/services/chats.test.ts`

Expected: FAIL because `ChatService` does not exist.

- [ ] **Step 2: Implement row mapping and source ownership validation**

Define private `ChatRow`/`MessageRow` mappers using shared schemas. Parse all three JSON columns inside `try/catch` and wrap schema/JSON errors as `InvalidStoredDataError`.

Validate source selection with one query:

```sql
SELECT id, notebook_id FROM sources WHERE id IN (?, ...)
```

Require the result count to equal input count and each `notebook_id` to match. Empty arrays skip the query. Preserve input order in JSON.

- [ ] **Step 3: Implement chat CRUD transactions**

Use UUIDs and UTC ISO timestamps. Create requires an existing notebook. Patch writes every resolved field plus `updated_at`. Delete checks `changes` and relies on the existing cascade. `getDetail` reads messages ordered by `seq ASC`; list uses `updated_at DESC, id ASC`.

- [ ] **Step 4: Write failing exchange sequencing tests**

```ts
const context = {
  sourceIds: [source.id],
  provider: 'nanogpt',
  model: 'gpt-4o-mini',
  strictness: 'grounded',
} as const;
const first = chats.beginExchange(chat.id, 'Question one', context);
const second = chats.beginExchange(chat.id, 'Question two', context);
expect([first.user.seq, first.assistant.seq, second.user.seq, second.assistant.seq]).toEqual([
  0, 1, 2, 3,
]);
expect(first.assistant).toMatchObject({ content: '', status: 'interrupted', context });
```

Assert user null context/reasoning, atomic adjacent inserts, chat/notebook timestamp updates, and update of assistant text/reasoning/status.

Run the focused file and confirm the new tests fail because exchange methods are absent.

- [ ] **Step 5: Implement exchange methods**

`beginExchange()` runs max-sequence lookup, two inserts, and timestamp updates in one `db.transaction()`. `updateAssistant(id, {content, reasoning, status})` updates only an assistant row, returns the parsed message, and throws `NotFoundError` otherwise. `getHistory(chatId)` returns ordered mapped messages.

- [ ] **Step 6: Run chat-service verification**

```bash
pnpm --filter @worldbookllm/server test -- src/services/chats.test.ts
pnpm --filter @worldbookllm/server typecheck
```

Expected: all chat persistence tests PASS and TypeScript exits 0.

- [ ] **Step 7: Commit and push**

```bash
git add apps/server/src/errors.ts apps/server/src/services/chats.ts apps/server/src/services/chats.test.ts
git commit -m "feat(server): add chat and message persistence"
git push origin main
```

### Task 3: Grounded Prompt Assembly

**Files:**

- Create: `apps/server/src/services/prompt-assembler.ts`
- Create: `apps/server/src/services/prompt-assembler.test.ts`

**Interfaces:**

- Produces `PromptAssembler.assemble(chat, history, newContent): ChatMessage[]`.
- Consumes `SourceService.get()` so every selected source is read from disk at assembly time.

- [ ] **Step 1: Write failing deterministic prompt tests**

Create two sources, select them in reverse creation order, externally edit one file, and assert the system message contains fresh bodies in selected order with escaped title attributes.

```ts
const messages = assembler.assemble(chat, history, 'What changed?');
expect(messages[0]).toEqual({ role: 'system', content: expectedSystemPrompt });
expect(messages.at(-1)).toEqual({ role: 'user', content: 'What changed?' });
```

Pin history rules: include users and complete assistants, include non-empty interrupted assistants, exclude error and empty interrupted assistants. Pin `No sources selected.` for an empty selection.

Run: `pnpm --filter @worldbookllm/server test -- src/services/prompt-assembler.test.ts`

Expected: FAIL because `PromptAssembler` does not exist.

- [ ] **Step 2: Implement exact source/system formatting**

Use the system preamble and grounded instruction verbatim from the Phase 6 design. Escape only source-title attribute characters with:

```ts
const XML_ATTRIBUTE_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '"': '&quot;',
  '<': '&lt;',
  '>': '&gt;',
};
```

Read sources by iterating `chat.sourceIds` and calling `sources.get(id)`. Do not sort, truncate, estimate tokens, or modify source bodies.

- [ ] **Step 3: Implement history mapping**

Map database roles to provider `ChatMessage`. Reasoning/context never enter history content. Apply the tested status/empty rules, then append the new user content.

- [ ] **Step 4: Run prompt verification and commit**

```bash
pnpm --filter @worldbookllm/server test -- src/services/prompt-assembler.test.ts
pnpm --filter @worldbookllm/server typecheck
git add apps/server/src/services/prompt-assembler.ts apps/server/src/services/prompt-assembler.test.ts
git commit -m "feat(server): assemble grounded chat prompts"
git push origin main
```

Expected: prompt tests PASS, TypeScript exits 0, checkpoint is pushed.

### Task 4: Provider HTTP Execution and Operations

**Files:**

- Create: `apps/server/src/providers/http-client.ts`
- Create: `apps/server/src/providers/http-client.test.ts`
- Create: `apps/server/src/services/providers.ts`
- Create: `apps/server/src/services/providers.test.ts`
- Create: `apps/server/src/routes/providers.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/app.test.ts`
- Modify: `apps/server/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/server/src/errors.ts`

**Interfaces:**

- Produces `ProviderHttpClient.fetchJson()` and `fetchStream()` with injected `typeof fetch`.
- Produces `ProviderService.getCatalog/listModels/testConnection/createChatRequest/openChatStream`.
- Produces provider routes consuming shared strict schemas.

- [ ] **Step 1: Add the provider workspace dependency and server bundle alias**

Run:

```bash
pnpm --filter @worldbookllm/server add '@worldbookllm/providers@workspace:*'
```

Update the build script with a second alias:

```text
--alias:@worldbookllm/providers=../../packages/providers/src/index.ts
```

Keep `--packages=external`; both raw workspace packages must be bundled into `dist/index.js` and `dist/app.js`.

- [ ] **Step 2: Write failing HTTP-client tests**

Inject small fake fetch functions and assert:

- object bodies are JSON encoded with content type;
- successful JSON is parsed once;
- malformed JSON, response text over 2 MiB, and non-2xx become `ProviderError`;
- errors contain source/status but not authorization values or credential-bearing URLs;
- the 30-second timer aborts JSON operations using fake timers;
- `fetchStream` rejects null bodies and returns a readable body otherwise.

Run: `pnpm --filter @worldbookllm/server test -- src/providers/http-client.test.ts`

Expected: FAIL because `ProviderHttpClient` does not exist.

- [ ] **Step 3: Implement the safe HTTP client**

Use `AbortSignal.any([callerSignal, AbortSignal.timeout(30_000)])` for JSON requests when a caller signal exists, and `AbortSignal.timeout(30_000)` otherwise. Do not apply the timeout in `fetchStream`.

Read capped response text by streaming bytes and cancel once the cap is exceeded; do not call unbounded `response.text()`. Extract an error message only from parsed `{error:{message}}`, `{error:string}`, or `{message:string}`, cap it at 500 characters, and fall back to `Provider request failed (HTTP N)`. Before constructing `ProviderError`, replace sensitive values found in authorization/API-key headers and `key`/`api_key` URL parameters with `[redacted]`.

- [ ] **Step 4: Write failing ProviderService tests**

Fixtures cover:

```ts
expect(service.getCatalog().find((item) => item.source === 'nanogpt')).toMatchObject({
  secretKey: 'api_key_nanogpt',
  hasSecret: true,
});
expect(JSON.stringify(service.getCatalog())).not.toContain(rawKey);
```

Also test static models without a key (zero fetches), live one-step parse, Azure two-step parse/ordering, required vs optional keys, live model-based connection tests, static completion-based connection tests, CometAPI disabled, and request plans receiving base URL/extra unchanged. Catalog order must equal `CHAT_COMPLETION_SOURCES`.

Run: `pnpm --filter @worldbookllm/server test -- src/services/providers.test.ts`

Expected: FAIL because `ProviderService` does not exist.

- [ ] **Step 5: Implement ProviderService**

Resolve metadata from `PROVIDER_META`. Read the active secret at method call time. Static model catalogs may be returned without a key; connection tests and generation throw `ConfigurationError` when a required key is absent. For catalog `hasSecret`, check only whether `readActive(secretKey)` is non-empty. Wrap synchronous provider-package request/plan construction failures as `ConfigurationError`; errors thrown after a remote request begins remain `ProviderError`.

Implement model-plan execution exactly:

```ts
if (plan.staticModels) return plan.staticModels;
let models: ModelInfo[] = [];
for (const [step, request] of plan.requests.entries()) {
  const data = await http.fetchJson(source, request);
  models = parseModelListResponse(source, data, step);
}
return models;
```

For static connection tests, build/execute a non-stream request and call `parseCompletionResponse`. For generation, `createChatRequest(config, messages)` injects active key and returns a streaming provider request; `openChatStream` delegates to `fetchStream`.

- [ ] **Step 6: Write failing provider-route integration tests**

Extend `app.test.ts` with catalog, model, and connection-test requests. Assert successful response shapes, strict validation, missing-key `409`, provider failure `502`, and absence of raw key text.

Run: `pnpm --filter @worldbookllm/server test -- src/app.test.ts -t "provider"`

Expected: FAIL with route-not-found responses.

- [ ] **Step 7: Register ProviderService and provider routes**

Register:

```ts
GET / api / providers;
POST / api / providers / models;
POST / api / providers / test;
```

Construct `ProviderService` with the injected fetch implementation and existing secret store, add it to `AppServices`, and parse shared schemas in each route. Return shared response shapes and map `ProviderError` to `502 provider_error`, `ConfigurationError` to `409 configuration_error`.

- [ ] **Step 8: Run provider checkpoint verification**

```bash
pnpm --filter @worldbookllm/server test -- src/providers/http-client.test.ts
pnpm --filter @worldbookllm/server test -- src/services/providers.test.ts
pnpm --filter @worldbookllm/server test -- src/app.test.ts
pnpm --filter @worldbookllm/server typecheck
pnpm --filter @worldbookllm/server build
```

Expected: focused tests, integration tests, typecheck, and bundled build all pass sequentially.

- [ ] **Step 9: Commit and push**

```bash
git add apps/server/package.json apps/server/src/errors.ts apps/server/src/providers apps/server/src/services/providers.ts apps/server/src/services/providers.test.ts apps/server/src/routes/providers.ts apps/server/src/app.ts apps/server/src/app.test.ts pnpm-lock.yaml
git commit -m "feat(server): add provider catalog models and tests"
git push origin main
```

### Task 5: Chat Routes and Generation Preflight

**Files:**

- Create: `apps/server/src/routes/chats.ts`
- Create: `apps/server/src/services/generation.ts`
- Create: `apps/server/src/services/generation.test.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/app.test.ts`

**Interfaces:**

- `buildApp(options?: {dataDir?: string; logger?: boolean; fetchImpl?: typeof fetch})` constructs all Phase 6 services.
- Produces `GenerationService.prepare(chatId, content): PreparedGeneration` and `stream(prepared, signal, emit): Promise<void>`.
- `PreparedGeneration.release()` is idempotent and must execute in the route's `finally`.

```ts
interface PreparedGeneration {
  chatId: string;
  source: ProviderSource;
  request: ProviderChatRequest;
  assistant: Message;
  release(): void;
}

type StreamEmitter = (event: StreamEvent) => void;

class GenerationService {
  constructor(
    chats: ChatService,
    notebooks: NotebookService,
    prompts: PromptAssembler,
    providers: ProviderService,
    logError?: (error: unknown) => void,
  );
  prepare(chatId: string, content: string): PreparedGeneration;
  stream(prepared: PreparedGeneration, signal: AbortSignal, emit: StreamEmitter): Promise<void>;
}
```

- [ ] **Step 1: Write failing chat-route CRUD tests**

Extend `app.test.ts` to cover every chat CRUD route, response status, source ownership rejection, override inheritance representation, message ordering on detail, deletion cascade, and stable validation/not-found bodies.

Run: `pnpm --filter @worldbookllm/server test -- src/app.test.ts -t "chat"`

Expected: FAIL with route-not-found responses.

- [ ] **Step 2: Register ChatService and CRUD routes**

Construct `ChatService(db)` in `buildApp`, add it to `AppServices`, and register the five non-streaming chat routes. Route handlers parse shared schemas and return `201/204` consistently with Phase 5 patterns.

- [ ] **Step 3: Write failing generation preflight tests**

Build real notebook/source/chat fixtures with the real `ProviderService` and an injected non-networking fetch stub. Assert:

- chat override wins over notebook settings;
- null override inherits notebook settings;
- absent settings or required key throws `ConfigurationError` before an exchange is inserted;
- provider request receives fresh prompt messages and `stream: true`;
- context snapshot contains source IDs, effective provider/model, and grounded strictness;
- a second `prepare` for the same chat throws `ConflictError`;
- any preflight exception releases the lock and inserts no messages.

Run: `pnpm --filter @worldbookllm/server test -- src/services/generation.test.ts -t "preflight"`

Expected: FAIL because `GenerationService` does not exist.

- [ ] **Step 4: Implement preflight and lock ownership**

`prepare()` acquires the chat ID in a `Set<string>`, then in `try`:

1. load chat detail and notebook;
2. resolve effective config;
3. assemble prompt from pre-insert history;
4. create the streaming provider request;
5. build the generation context;
6. call `beginExchange` last;
7. return request, source, assistant message, and idempotent release closure.

The `catch` path removes the lock before rethrowing. No network request occurs during preflight.

- [ ] **Step 5: Run CRUD/preflight verification**

```bash
pnpm --filter @worldbookllm/server test -- src/app.test.ts -t "chat"
pnpm --filter @worldbookllm/server test -- src/services/generation.test.ts -t "preflight"
pnpm --filter @worldbookllm/server typecheck
```

Expected: chat route and preflight tests pass.

### Task 6: Normalized SSE, Errors, and Abort Persistence

**Files:**

- Modify: `apps/server/src/services/generation.ts`
- Modify: `apps/server/src/services/generation.test.ts`
- Modify: `apps/server/src/routes/chats.ts`
- Create: `apps/server/src/generation.nanogpt.smoke.test.ts`

**Interfaces:**

- `GenerationService.stream()` emits validated `StreamEvent` values and owns all assistant persistence.
- Message route writes encoded application events and never writes provider event payloads directly.

- [ ] **Step 1: Write a scripted provider test harness**

In `generation.test.ts`, start a Node `createServer()` on port 0. Route `/v1/chat/completions` returns configurable OpenAI-shaped SSE chunks, non-2xx JSON, or a delayed stream that records socket close. Close the server in `afterEach`; never leave a listener/watch process alive.

- [ ] **Step 2: Write failing successful-stream tests**

Prepare a custom-provider chat pointed at the scripted server. Capture emitted events and assert:

```ts
expect(events).toEqual([
  { type: 'delta', text: 'Am' },
  { type: 'delta', text: 'ber', reasoning: 'thinking' },
  { type: 'done', message: expect.objectContaining({ content: 'Amber', status: 'complete' }) },
]);
```

After every emitted delta, read the assistant row and assert it already contains the emitted cumulative text/reasoning. Assert `[DONE]`, finish-only, role-only, and keepalive chunks produce no application event. A stream that reaches `[DONE]` or EOF without a text/reasoning delta must produce an error terminal event and persisted `status: error`, never a complete empty assistant.

Run: `pnpm --filter @worldbookllm/server test -- src/services/generation.test.ts -t "successful stream"`

Expected: FAIL because streaming is not implemented.

- [ ] **Step 3: Implement normalized stream accumulation**

Use `ProviderService.openChatStream`, `parseSseStream`, and `normalizeStreamChunk`. Parse each non-`[DONE]` data field as JSON; malformed provider JSON becomes `ProviderError`. Append text/reasoning, call `updateAssistant(...interrupted)` before `emit(delta)`, then on EOF update complete and emit done.

- [ ] **Step 4: Write failing provider-error and abort tests**

Assert:

- upstream non-2xx produces one `error/provider_error` event and persisted `status: error`;
- provider error mid-stream retains partial content and reasoning with `status: error`;
- unexpected error emits `internal_error` with public `Internal server error`;
- aborting the signal closes the provider socket, emits no terminal event, and leaves partial content `interrupted`;
- `release()` after every path permits the next prepare for the chat.

Run the focused tests and confirm expected status/event mismatches before implementation.

- [ ] **Step 5: Implement failure classification and abort behavior**

In `stream()` catch:

```ts
if (signal.aborted) {
  awaitPersist('interrupted');
  return;
}
if (error instanceof ProviderError) {
  const messageState = awaitPersist('error');
  emit({
    type: 'error',
    code: 'provider_error',
    message: 'Provider generation failed',
    messageState,
  });
  return;
}
const messageState = awaitPersist('error');
emit({ type: 'error', code: 'internal_error', message: 'Internal server error', messageState });
```

All persistence methods are synchronous; the pseudocode name denotes the status transition, not a Promise. Log provider and unexpected errors through the injected `logError` callback without exposing detailed text in stream events. Production passes Fastify's error logger; tests pass a spy.

- [ ] **Step 6: Write failing real-listener route and abort integration tests**

Start the Fastify app on port 0 and use Node `fetch` to POST a message. Assert content type and required headers before implementing the route. Parse application SSE and require normalized deltas, one terminal event, and persisted detail after reload. For abort, read the first delta, call `controller.abort()`, wait for the scripted upstream socket-close condition, then require `interrupted` partial state. Start a delayed request and assert a concurrent POST receives `409 generation_in_progress`.

Run: `pnpm --filter @worldbookllm/server test -- src/services/generation.test.ts -t "message route"`

Expected: FAIL because the message route is absent.

- [ ] **Step 7: Implement the Fastify SSE route**

Validate params/body and call `prepare()` before headers. Then set:

```ts
reply.hijack();
reply.raw.writeHead(200, {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
});
```

Create an `AbortController`, abort it from `reply.raw.once('close')`, and write `encodeSseEvent(event)` only when `!reply.raw.destroyed`. In `finally`, remove the close listener, call `prepared.release()`, and end only when writable.

- [ ] **Step 8: Add the env-gated live NanoGPT server smoke**

The smoke test must:

1. skip only when `SMOKE_NANOGPT_KEY` is absent;
2. create an isolated app/data directory;
3. add the key through `POST /api/secrets`;
4. create a NanoGPT notebook using `SMOKE_NANOGPT_MODEL ?? 'gpt-4o-mini'`;
5. create a source and selected-source chat;
6. stream `Reply with exactly: brass` through the application message route;
7. assert a done event containing `brass` and persisted complete assistant;
8. close the app and remove the temporary directory.

- [ ] **Step 9: Run generation checkpoint verification**

```bash
pnpm --filter @worldbookllm/server test -- src/services/generation.test.ts
pnpm --filter @worldbookllm/server test -- src/app.test.ts
pnpm --filter @worldbookllm/server typecheck
pnpm --filter @worldbookllm/server build
```

Expected: fake-provider, route, typecheck, and bundled build pass.

- [ ] **Step 10: Commit and push**

```bash
git add apps/server/src/app.ts apps/server/src/app.test.ts apps/server/src/routes/chats.ts apps/server/src/services/generation.ts apps/server/src/services/generation.test.ts apps/server/src/generation.nanogpt.smoke.test.ts
git commit -m "feat(server): stream persisted grounded chat generation"
git push origin main
```

### Task 7: Final Review and Mandatory Live Verification

**Files:**

- Modify only files required by review findings, with a failing regression test first.
- Update after verification: `/home/dev/.claude/tasks/3d065225-2722-4186-b181-578eb9721459/6.json` (outside the repository).

**Interfaces:**

- Produces a clean Phase 6 commit on remote `main` with all fake/live generation evidence green.

- [ ] **Step 1: Review the complete Phase 6 range**

```bash
BASE_SHA=$(git rev-list -n 1 --grep='docs: plan Phase 6 chat generation' HEAD)
git diff "$BASE_SHA"..HEAD --check
git diff "$BASE_SHA"..HEAD --stat
git status --short --branch
```

Review against both Phase 6 and cross-phase designs. Specifically inspect raw-secret leakage, credential-bearing URLs, provider chunks reaching browser SSE, source ownership, corrupted JSON classification, lock release, response-close races, assistant status on every path, database handles, and bundled raw-workspace imports.

- [ ] **Step 2: Run final gates sequentially**

```bash
pnpm lint
pnpm format:check
pnpm --workspace-concurrency=1 -r typecheck
pnpm --workspace-concurrency=1 -r test
pnpm --workspace-concurrency=1 -r build
```

Expected: every command exits 0. The normal workspace test may report the env-gated live test as skipped; do not count that as live verification.

- [ ] **Step 3: Run mandatory authorized NanoGPT smoke**

Inject the key without printing it:

```bash
SMOKE_NANOGPT_KEY=$(node --input-type=module -e "import fs from 'node:fs'; const data=JSON.parse(fs.readFileSync('/home/dev/SillyTavern/data/default-user/secrets.json','utf8')); const entry=data.api_key_nanogpt; const value=Array.isArray(entry) ? (entry.find(item => item?.active)?.value ?? entry[0]?.value) : entry; if (typeof value !== 'string' || value.length === 0) process.exit(2); process.stdout.write(value);") pnpm --filter @worldbookllm/server test -- generation.nanogpt.smoke.test.ts
```

Expected: the live generation test executes (not skipped), streams `brass`, and all smoke-file tests pass. Never echo or log the key.

- [ ] **Step 4: Run compiled-server smoke**

Build, start `apps/server/dist/index.js` against a temporary data directory and unused local port, call health plus chat CRUD endpoints, then terminate it. Assert the process does not raise `ERR_UNKNOWN_FILE_EXTENSION` for either workspace package.

- [ ] **Step 5: Commit review fixes, push, and confirm remote state**

```bash
git add packages/shared/src/provider-config.ts packages/shared/src/chats.ts packages/shared/src/providers.ts packages/shared/src/stream-events.ts packages/shared/src/phase6-schemas.test.ts packages/shared/src/index.ts apps/server/package.json apps/server/src/errors.ts apps/server/src/providers apps/server/src/services/chats.ts apps/server/src/services/chats.test.ts apps/server/src/services/prompt-assembler.ts apps/server/src/services/prompt-assembler.test.ts apps/server/src/services/providers.ts apps/server/src/services/providers.test.ts apps/server/src/services/generation.ts apps/server/src/services/generation.test.ts apps/server/src/routes/providers.ts apps/server/src/routes/chats.ts apps/server/src/app.ts apps/server/src/app.test.ts apps/server/src/generation.nanogpt.smoke.test.ts pnpm-lock.yaml
git commit -m "fix(server): harden Phase 6 generation"
git push origin main
git diff --check
git status --short --branch
git rev-parse HEAD
git rev-parse origin/main
```

If review finds no changes, do not create an empty commit. Expected final state is a clean `main...origin/main` with identical SHAs.

- [ ] **Step 6: Mark Phase 6 complete**

Set task 6 status to `completed` only after all final gates, the executed live NanoGPT smoke, compiled-server smoke, final push, and clean remote comparison. Then begin the just-in-time Phase 7 design/plan cycle using the actual Phase 6 contracts.
