# Phase 8 Provider Settings and Keys Web Design

**Date:** 2026-07-13

**Status:** Ready for implementation planning; conforms to the M1 phases 6–9 contract baseline

**Baseline:** Phase 7 merged to `main` at commit `b4bfc47`

## Context

Phase 6 shipped every server contract this phase consumes: the provider catalog, model discovery, connection tests, masked secret routes, and chat CRUD. Phase 7 shipped the web foundation: routing, the typed `ApiClient`, the notebook workspace with source navigation, and a reserved chat region. The `/settings` route currently renders a static placeholder, and the web client calls no provider, secret, or chat endpoint.

Phase 8 covers steps 3 and 4 of the M1 acceptance journey — add or select a masked provider key, then configure a provider and model for a notebook using live/static model lists and a connection test — plus the minimal chat create/select shell that Phase 9 activates with messages and streaming.

This phase changes only `apps/web`. Server routes, shared schemas, and the provider package are frozen; a contract defect discovered during implementation is fixed as its own reviewed change, not silently absorbed here.

## Goals

- Extend the typed `ApiClient` with provider, secret, and chat operations validated by the existing shared schemas.
- Add settings navigation and replace the `/settings` placeholder with masked multi-key management: list, add, activate (rotate), and delete keys per provider.
- Render provider connection fields generically from `ProviderCatalogEntry` descriptors so the whole catalog works without per-provider UI code, with two documented carve-outs (CometAPI is disabled upstream; Vertex AI `full` auth is deferred past M1).
- Provide model discovery (live and static) and a real connection test inside one reusable provider-configuration editor.
- Persist notebook provider defaults through the existing `PATCH /api/notebooks/:id` `settings` field.
- Replace the reserved chat region with a minimal chat shell: list, create, select, rename, and delete chats, and edit each chat's provider override.

## Non-goals

- Messages, prompt submission, SSE consumption, stop controls, or any streaming UI; Phase 9 owns them, including the walking-skeleton E2E.
- Server, shared-schema, or provider-package changes; no new HTTP routes and no new route paths in the SPA.
- Displaying secret values unmasked, caching submitted key material, or exposing secret IDs outside the settings flows that need them.
- Per-chat source selection controls (Phase 9) beyond preserving whatever `sourceIds` a chat already has.
- Provider-specific bespoke forms, model favorites, or key import from other tools.

## Architecture

Phase 8 adds four web units on top of the Phase 7 foundation:

1. **API client extensions** — new `ApiClient` methods for providers, secrets, and chats, following the existing `request()` helper and zod response validation.
2. **Settings page** — `/settings` becomes the provider key manager, driven entirely by `GET /api/providers` and the secret routes.
3. **Provider configuration editor** — one reusable component (catalog-driven fields, model discovery, connection test) used by both the notebook-defaults dialog and the chat-override dialog.
4. **Chat shell** — the `chat-reserve` region of `NotebookWorkspace` becomes a functional chat list with create/select/rename/delete and override editing; the message area remains an explicit Phase 9 placeholder.

All new UI reuses the established patterns: `dialog-backdrop`/`dialog-card` modals with `useDialogLifecycle`, `ConfirmDialog` for destructive actions, `LoadingState`/`ErrorState` for request states, the `button-primary`/`button-secondary`/`button-danger` classes, and `coordinate-label` eyebrows. New styles append to the single `styles.css`.

## API Client Extensions

`apps/web/src/api/client.ts` gains the following methods, each validated with the named shared schema:

```ts
// Providers
getProviderCatalog(signal?): Promise<ProviderCatalogEntry[]>; // GET /api/providers → z.array(providerCatalogEntrySchema)
listModels(connection: ProviderConnection, signal?): Promise<ModelListResponse>; // POST /api/providers/models → modelListResponseSchema
testConnection(config: ProviderConfig, signal?): Promise<ConnectionTestResponse>; // POST /api/providers/test → connectionTestResponseSchema

// Secrets
getSecrets(signal?): Promise<SecretState>; // GET /api/secrets → secretStateSchema
createSecret(input: z.input<typeof createSecretSchema>, signal?): Promise<MaskedSecret>; // POST /api/secrets → maskedSecretSchema
activateSecret(key: string, id: string, signal?): Promise<void>; // POST /api/secrets/:key/:id/activate → 204
deleteSecret(key: string, id: string, signal?): Promise<void>; // DELETE /api/secrets/:key/:id → 204

// Chats
listChats(notebookId: string, signal?): Promise<Chat[]>; // GET /api/notebooks/:id/chats → z.array(chatSchema)
createChat(notebookId: string, input: z.input<typeof createChatSchema>, signal?): Promise<Chat>; // POST /api/notebooks/:id/chats → chatSchema
getChat(id: string, signal?): Promise<ChatDetail>; // GET /api/chats/:id → chatDetailSchema
updateChat(id: string, input: PatchChat, signal?): Promise<Chat>; // PATCH /api/chats/:id → chatSchema
deleteChat(id: string, signal?): Promise<void>; // DELETE /api/chats/:id → 204
```

Path segments are URI-encoded as in the existing methods. Notebook defaults reuse the existing `updateNotebook(id, { settings })`. The shared package already exports every schema; if a list wrapper (for example `chatListSchema` or `providerCatalogSchema`) is missing, the client composes `z.array(...)` locally rather than adding shared exports. Likewise, shared exports no `CreateSecretInput`/`CreateChatInput` types: the create-secret and create-chat parameters use the schema input types (`z.input<typeof createSecretSchema>`, `z.input<typeof createChatSchema>`) locally, so callers can omit defaulted fields (`label`, `title`, `sourceIds`, `providerOverride`) exactly as the server accepts them, without new shared exports.

`src/test/createTestClient.ts` grows the same methods with the existing default convention: list-style reads resolve empty (`getProviderCatalog` and `listChats` as `[]`, `getSecrets` as `{}`), and every other method rejects `Unexpected API call` unless overridden.

Error handling is unchanged: non-2xx responses become `ApiClientError(status, code, message, issues)` from the shared `apiErrorSchema`. The UI maps `409 configuration_error` and `502 provider_error` to inline, human-readable failures near the control that triggered them.

## Settings Page

`pages/SettingsPlaceholder.tsx` is replaced by `settings/SettingsPage.tsx` at the existing `/settings` route, and `AppShell` gains a `Settings` link in the site header so the page is reachable without typing a URL.

On load the page fetches the provider catalog and the masked secret state in parallel; either failure renders `ErrorState` with retry. The page renders one section per catalog entry, ordered as the server returns them:

- **Provider row** — `label`, family badge (`openai-compat`/`dedicated`), a configured indicator driven by `hasSecret`, and a note when `keyOptional` is set.
- **Key panel** (expanded per provider) — the masked keys stored under the entry's `secretKey`: masked `value`, `label`, and an `active` marker. Actions:
  - **Add key** — a dialog with label (optional, defaults server-side to `Unlabeled`) and a write-only value field (`type="password"`). On success the dialog closes and the panel re-reads server state; the submitted value is never kept in component state after the request settles.
  - **Make active** — `activateSecret`; exactly one key per `secretKey` is active, and rotation takes effect on future provider calls without touching notebook or chat configuration.
  - **Delete** — `ConfirmDialog`, then `deleteSecret`.

Providers that share a `secretKey` display the same key list; this mirrors server truth and needs no dedupe logic. After every mutation the page refreshes `GET /api/secrets` (and the catalog when `hasSecret` may have flipped) so the server stays authoritative.

## Provider Configuration Editor

`providers/ProviderConfigEditor.tsx` is the single form used everywhere a `ProviderConfig` is edited. It receives the catalog, an initial `ProviderConfig | null`, and returns a valid config via `onSubmit`. Its behavior is entirely descriptor-driven:

- **Provider select** — all catalog entries by `label`. Switching providers clears model, base URL, and extras.
- **Key status** — a passive indicator from `hasSecret`, with a link to `/settings` when no key exists and `keyOptional` is not set. The editor never collects key material.
- **Base URL** — a URL input rendered only when `needsBaseUrl` is true; required in that case.
- **Extra fields** — one input per `extraFields` descriptor: a select when `options` is present, otherwise a text input; `required` gates submission. Values are passed through unchanged as the `extra` record. One documented M1 carve-out: the Vertex AI `authMode` catalog metadata only offers `express`, because full service-account auth requires an `extra.accessToken` the catalog does not describe and Phase 6 explicitly deferred full Vertex OAuth; the editor renders the catalog options verbatim.
- **Model** — a `Load models` action calls `listModels` with the current connection fields and fills a select (`id`, with `name` shown when present, provider order preserved). Most static-model providers resolve instantly through the same call from the bundled catalog; Azure OpenAI is the exception — despite `modelSource: 'static'` its server-side plan performs a live deployment probe requiring base URL, deployment name, API version, and an active key. The editor does not special-case this: discovery is one code path, and on failure it shows the error and falls back to a free-text model input, since a reachable-but-unlisted model is still a valid configuration.
- **Connection test** — enabled once the form holds a complete `ProviderConfig`; calls `testConnection` and renders the returned `detail` on success or the safe error message on failure. Testing is advisory: a failed or skipped test does not block saving.

The editor validates its output against `providerConfigSchema` before submitting, so callers only ever receive a wire-valid config.

CometAPI remains in the catalog but is disabled inside the provider package: its model-list and chat request builders throw a pinned `CometAPI is temporarily disabled.` error. The editor adds no special casing — model discovery and connection tests for CometAPI surface that safe provider error like any other failure, and a working configuration cannot be produced until the provider package re-enables it.

## Notebook Provider Defaults

The chat region gains a configuration header showing the notebook's effective defaults — provider label and model from `notebook.settings`, or a `Not configured` state. A `Configure provider` action opens a dialog hosting `ProviderConfigEditor`; saving calls `updateNotebook(id, { settings })` and replaces workspace state with the returned notebook.

`NotebookWorkspaceContext` gains a `replaceNotebook(notebook: Notebook)` callback so the dialog can update the shared notebook without a full workspace reload. Clearing defaults (`settings: null`) is allowed; chat creation and override editing still work, and generation-time enforcement remains the server's `409 configuration_error`.

Provider changes affect future exchanges only; nothing in this phase rewrites existing chats or messages.

## Chat Shell

The `chat-reserve` placeholder in `NotebookWorkspace.tsx` becomes `chats/ChatPanel.tsx`. Per the cross-phase contract, chat selection introduces no new routes: the selected chat ID is ephemeral panel state, and Phase 9 may revisit persistence.

- **Chat list** — `listChats` on mount, ordered as returned (`updated_at DESC`). Each row shows the title and an inherit/override marker. Loading, error-with-retry, and empty (`No chats yet`) states are explicit.
- **Create** — `createChat` with schema defaults (`New chat`, no sources, null override), then the new chat becomes selected.
- **Select** — highlights the row and shows a detail header for that chat: title, effective provider summary (override when non-null, otherwise the notebook defaults, otherwise `Not configured`), and the chat actions below. The message body area renders a placeholder stating that messages arrive in Phase 9.
- **Rename** — a small dialog submitting `updateChat(id, { title })`.
- **Override** — an `Edit provider override` action opens `ProviderConfigEditor` seeded with the current override (or the notebook defaults as a starting point when null). Saving submits a complete `ProviderConfig` via `updateChat(id, { providerOverride })`; a separate `Use notebook default` action submits `providerOverride: null`. Overrides are complete replacements, never partial merges.
- **Delete** — `ConfirmDialog`, then `deleteChat`; a deleted selected chat deselects and the list refreshes.

Patches never touch `sourceIds`, preserving any existing selection for Phase 9.

## UI State and Failure Semantics

- Server responses replace local state after every mutation; no optimistic secret, settings, or chat state survives a failed request.
- Secret inputs are write-only: cleared on success, cleared on dialog close, never logged or echoed back.
- Closing a dialog aborts the browser request for in-flight model discovery or connection tests via `AbortSignal` (the workspace's `AbortController` pattern) and discards stale results. This does not cancel the server's upstream provider call, which runs to completion or its 30-second timeout — accepted M1 behavior, since the frozen routes carry no cancellation channel.
- Validation failures (`400`) render field-level messages from `ApiClientError.issues` where they map to a field, otherwise inline alerts (`role="alert"`).
- `409`/`502` provider failures render the server's safe message verbatim; the UI never invents provider detail and never sees keys, provider URLs, or raw provider errors.
- Dialogs follow the `useDialogLifecycle` contract: focus on open, Escape to close, actions disabled while a request is in flight.

## Testing Strategy

Vitest + testing-library component tests follow the `SourceWorkspace.test.tsx` pattern: render `AppRoutes` in a `MemoryRouter` with a `createTestClient` override, drive with `userEvent`.

### API client

- Each new method: URL, verb, body serialization, response validation, and `ApiClientError` mapping, extending `api/client.test.ts`.

### Settings page

- Catalog + secret rendering with masked values and active markers; `hasSecret` indicator.
- Add-key dialog success (state refresh, value not retained), activate, delete-with-confirm, and error/retry states.

### Provider configuration editor

- Generic rendering across representative descriptors: a dedicated provider, an openai-compat provider with `needsBaseUrl`, and an extra-fields provider with `options` (for example `azure_openai` or `workers_ai`).
- Model discovery success populating the select, failure falling back to free-text entry.
- Connection test success (`detail` shown) and failure (safe message shown, save still possible).
- Submission blocked until `providerConfigSchema` is satisfiable; provider switch clears dependent fields.

### Notebook defaults and chat shell

- Configure dialog saves through `updateNotebook` and updates the workspace header without reload.
- Chat list/create/select/rename/delete flows, including empty and error states.
- Override editing: complete-replacement submit, `Use notebook default` sending null, and the inherit/override indicator tracking server responses.

## Verification

Repository gates run sequentially with workspace concurrency one: `lint`, `format:check`, `typecheck`, `test`, `build`. Manual verification against the dev server covers the journey slice: open `/settings`, add a NanoGPT key and see it masked and active; open a notebook, configure NanoGPT plus a discovered model, pass the connection test, save defaults; create a chat and set then clear a provider override. No live provider call is required beyond the connection test and model list exercised manually; the Phase 9 E2E owns automated live verification.

## Acceptance Criteria

- `/settings` manages masked, rotatable, deletable keys for every catalog provider without exposing secret values after submission.
- Every enabled provider can be configured through descriptor-driven fields alone (CometAPI stays listed but surfaces its pinned upstream-disabled error; Vertex AI offers only `express` auth); model lists load live or static through one code path, with manual model entry as the failure fallback.
- Connection tests report the server's `ok`/`detail` result and safe failures.
- Notebook defaults persist in `Notebook.settings` via the existing PATCH route and render in the workspace.
- Chats can be created, selected, renamed, deleted, and given a complete provider override or returned to notebook inheritance, with the precedence rule visible in the UI.
- No new server routes, SPA routes, or shared-schema changes; all repository gates pass.
