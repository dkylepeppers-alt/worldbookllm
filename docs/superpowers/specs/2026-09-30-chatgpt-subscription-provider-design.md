# ChatGPT Subscription Provider Design

**Date:** 2026-09-30

**Status:** Proposed design, pending review and implementation plan

**Decision record:** ADR 0016

**Reference implementation:** Marinara Engine commit `12a0acd5b7823abeaf3e05ad39a3a07d957e9ffc`:

- `packages/server/src/services/llm/openai-chatgpt-auth.ts`
- `packages/server/src/services/llm/providers/openai-chatgpt.provider.ts`
- the Responses path of `packages/server/src/services/llm/providers/openai.provider.ts` (`formatResponsesInput`, `buildResponsesBody`, `chatResponses`, `chatCompleteResponses`)

## Context

Every worldbookllm provider is authenticated with an API key from the secret store. This design adds one source, `openai_chatgpt`, that bills against the user's ChatGPT plan. It works by reusing the OAuth tokens that the Codex CLI stores after `codex login`, and by sending OpenAI Responses API requests to the Codex backend. ADR 0016 records the decision. This document specifies how each layer changes.

A Claude subscription provider (Claude Agent SDK) was considered in the same request and is out of scope here. The only constraint already settled for it is that it will not be tool-capable (ADR 0016, point 7).

## Goals

- **Chat, regenerate, and source organization** work through `openai_chatgpt` with no API key configured.
- **Model discovery** comes from the Codex backend's live model list.
- **Tokens:** they are refreshed automatically and written back where the Codex CLI will find them. They never enter the secret store, request snapshots, logs, or error messages.
- **`packages/providers` stays pure:** no filesystem, network, or secret access.
- **Docker deployments** have a documented way to supply the login.
- **Agent mode** is enabled for this source if, and only if, a live check shows that the endpoint accepts function tools.

## Non-goals

- Running an OAuth sign-in flow inside worldbookllm. Sign-in is always `codex login` on the server's machine.
- The Claude subscription provider.
- The Responses API for the ordinary `openai` API-key source. That source stays on Chat Completions, pinned to SillyTavern `29e0df488`.
- Encrypted reasoning replay across turns. `store: false` and worldbookllm's message model do not persist provider reasoning items, and Marinara does not replay them on this path either.
- Usage and cost accounting.

## Endpoint facts taken from the reference

These are what Marinara does today. The ones marked **unverified** are behaviors Marinara avoids, so it gives no evidence whether the endpoint allows them. The live smoke test (see Testing) settles each one before the implementation plan is finalized.

| Item                                 | Value                                                                                                                                                                                                                            |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base URL                             | `https://chatgpt.com/backend-api/codex`                                                                                                                                                                                          |
| Generation                           | `POST {base}/responses`, SSE stream, `stream: true` always                                                                                                                                                                       |
| Model list                           | `GET {base}/models?client_version=<version>` → `{ models: [{ slug, display_name }] }`                                                                                                                                            |
| Auth header                          | `Authorization: Bearer <access_token>`                                                                                                                                                                                           |
| Extra headers                        | `ChatGPT-Account-ID: <account id>` when known; `X-OpenAI-Fedramp: true` for FedRAMP accounts; `originator`, `version`, `User-Agent` identifying the client                                                                       |
| Required body fields                 | `model`, `input`, `instructions` (non-empty; Marinara falls back to `"You are a helpful assistant."`), `store: false`, `stream: true`                                                                                            |
| Omitted by Marinara (**unverified**) | `temperature`, `top_p`, `max_output_tokens`, `reasoning`, `include`, `text`, `tools`, `tool_choice`, `service_tier`                                                                                                              |
| Token file                           | `$CODEX_HOME/auth.json`, default `~/.codex/auth.json`; `tokens.{access_token, refresh_token, id_token, account_id}`, `last_refresh`, `auth_mode`                                                                                 |
| Refresh                              | `POST https://auth.openai.com/oauth/token`, JSON `{ client_id: "app_EMoamEEZ73f0CkXaXp7hrann", grant_type: "refresh_token", refresh_token }` → new `access_token`, and optionally a rotated `refresh_token` and a new `id_token` |
| Refresh trigger                      | the access token's JWT `exp` falls within 60 seconds, or `last_refresh` is older than 8 days                                                                                                                                     |
| Account ID source                    | `tokens.account_id`, else the `chatgpt_account_id` claim under `https://api.openai.com/auth` in the ID token, else the same claim in the access token                                                                            |

## Architecture

### Package boundary

`packages/providers` gains a request builder, stream and tool-call handling, and a model-list plan for the new source. It never sees the token file. The server resolves credentials and attaches them to the built request immediately before sending it, in the same method that performs the fetch.

Attaching credentials at send time is a departure from how API keys flow today, where they are passed into `buildChatRequest`. There are two reasons:

- **Refresh is async.** `GenerationService.prepare()` and `prepareRegeneration()` are synchronous, and token refresh is asynchronous. `ProviderService.openChatStream()`, `completeChat()`, and `listModels()` are already async, so the credential step fits there without changing the generation or agent call chains.
- **The token never enters a stored object.** It appears only in the request's headers at send time, never in the object snapshotted for the Prompt Inspector.

### Changed and new files

**`packages/shared`**

- **`src/provider-config.ts`:** add `'openai_chatgpt'` to `PROVIDER_SOURCES`.
- **`src/providers.ts`:** add `auth: z.enum(['api-key', 'codex-login'])` to `providerCatalogEntrySchema`, which is strict, so the field must be declared.

**`packages/providers`**

- **`src/types.ts`:** add `'openai_chatgpt'` to `ChatCompletionSource`.
- **`src/sources.ts`:**
  - Add the source to `CHAT_COMPLETION_SOURCES`.
  - Add `API_URLS.openaiChatgpt`.
  - Add a `PROVIDER_META` entry: `family: 'dedicated'`, `modelSource: 'live'`, `secretKey: 'api_key_openai_chatgpt'` (unused, but the field is required), and a new `auth: 'codex-login'`. Every other entry gets `auth: 'api-key'`, or the field defaults to it.
- **`src/request/openai-chatgpt.ts` (new, Marinara attribution header):** `buildOpenAiChatgptRequest(params)`. See Request mapping.
- **`src/request/build-request.ts`:** dispatch `openai_chatgpt` to the new builder. The `source satisfies never` exhaustiveness check forces this.
- **`src/stream/normalize.ts`:** add `normalizeResponses(payload)` and dispatch to it for `openai_chatgpt`. See Stream mapping.
- **`src/stream/tool-calls.ts`:** `ToolCallAccumulator.push` recognizes Responses function-call events by their `type` field, the way it already recognizes Cohere v2 events.
- **`src/models/list-models.ts`:** a one-request plan for `GET {base}/models?client_version=…`, and a parser for `models[].slug` and `display_name`.
- **`src/request/tools.ts`:** add `openai_chatgpt` to `TOOL_CALLING_SOURCES` only after the live tool check passes.

**`apps/server`**

- **`src/providers/codex-auth.ts` (new, Marinara attribution header):**
  - Reads the auth file, reports whether a login is present, and returns `{ accessToken, accountId, isFedramp }`, refreshing first when needed.
  - Refreshes are single-flight: one in-flight promise shared by all callers.
  - After a refresh it writes the file back as pretty-printed JSON with mode `0600`.
  - It takes an injected `fetch` and clock for tests.
  - Errors are `ConfigurationError`s whose messages tell the user to run `codex login` on the server's machine. That covers a missing file, `auth_mode` of API key, a missing refresh token, and a failed refresh. Messages never include token values.
- **`src/services/providers.ts`:**
  - `requireApiKey` skips `codex-login` sources.
  - A private `authorize(source, request)` adds `Authorization` and the extra headers for `openai_chatgpt`, and passes every other request through unchanged. `openChatStream`, `listModels`, and `completeChat` call it before handing the request to `ProviderHttpClient`.
  - `completeChat` for this source builds a streaming request and concatenates `normalizeStreamChunk` text until the stream ends.
  - `getCatalog` reports `auth` and sets `hasSecret` from the auth module's login check.
- **`src/env.ts`:** add `resolveCodexHome(explicit?)`, which returns `CODEX_HOME` or `~/.codex`, following the existing `resolveDataDir` pattern.

**`apps/web`**

- **`src/settings/SettingsPage.tsx`:** for `auth: 'codex-login'` entries, show sign-in status, or the instruction to run `codex login` on the server's machine, in place of the key list and "Add key" control.
- **`src/providers/ProviderConfigEditor.tsx`:** treat a `codex-login` source as ready when `hasSecret` is true, and show the same instruction when it is not.

**Docs**

- **`docs/DEPLOYMENT.md`:** a `CODEX_HOME` row, and a Docker recipe that bind-mounts the host's `~/.codex` to `/root/.codex`, writable.
- **`docs/ARCHITECTURE.md`:** note the second credential path.
- **`.claude/skills/providers-port/SKILL.md` and `AGENTS.md`:** note that `openai_chatgpt` is adapted from Marinara Engine rather than SillyTavern and has its own reference commit.

## Request mapping

`buildOpenAiChatgptRequest` converts worldbookllm's canonical `ChatMessage[]` into Responses input:

| Canonical message                        | Responses `input` item                                                                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Leading `system` messages                | Joined with blank lines into top-level `instructions`                                                                                                               |
| Later `system` messages                  | `{ role: 'system', content }`, kept in position                                                                                                                     |
| `user` / `assistant` with string content | `{ role, content }`; empty content skipped                                                                                                                          |
| Content-part arrays                      | text parts → `input_text` (user) or `output_text` (assistant); image parts → `input_image`                                                                          |
| `assistant` with `tool_calls`            | Its text first (if any), then one `{ type: 'function_call', call_id, name, arguments }` per call, with `arguments` serialized to a JSON string when it is an object |
| `tool`                                   | `{ type: 'function_call_output', call_id: tool_call_id, output: content }`                                                                                          |

- **Empty input:** if no input items remain, add a single user item, `Continue.`, as Marinara does.
- **Tools:** when tools are present and the source is tool-capable, emit `tools` as `{ type: 'function', name, description, parameters }` and `tool_choice` from `params.toolChoice` (default `auto`).
- **`function_call` item IDs:** Marinara sets `id` and rewrites IDs to an `fc_` prefix. This design omits `id` and sends only `call_id`, since worldbookllm never replays stored response items. The live smoke test's tool round trip confirms the endpoint accepts that.
- **Parameters not sent in the first version:** temperature, top-p, max tokens, reasoning effort, and assistant prefill. The Responses API has no prefill. The rest follow the reference until the live test shows the endpoint accepts them. `snapshotRequestBody` therefore shows exactly what was sent, and the Prompt Inspector reflects the dropped controls.
- **Headers:** the builder emits only `Content-Type` and `Accept: text/event-stream`. Credential and identity headers come from `authorize`, using `originator: worldbookllm` and a client version string. Every workspace package is versioned `0.0.0` today, so which version to send is part of open question 4.

## Stream mapping

`parseSseStream` already yields each event's `data`. Responses streams do not send `[DONE]` and end when the connection closes, which the existing loops handle.

| Event `type`                                                                             | Result                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `response.output_text.delta`                                                             | text delta from `delta`                                                                                                                                                                        |
| `response.reasoning_summary_text.delta`                                                  | reasoning delta from `delta`                                                                                                                                                                   |
| `response.output_item.added` with `item.type === 'function_call'`                        | accumulator opens a call keyed by `item.id`, recording `call_id` and `name`                                                                                                                    |
| `response.function_call_arguments.delta`                                                 | accumulator appends `delta` to the call named by `item_id`                                                                                                                                     |
| `response.output_item.done` with `item.type === 'function_call'`                         | accumulator replaces arguments with the final `item.arguments`                                                                                                                                 |
| `response.failed`                                                                        | `ProviderError` carrying `response.error.message`                                                                                                                                              |
| `error`                                                                                  | `ProviderError` carrying `message`. The existing `providerError` check in `normalize.ts` already throws on a top-level `message` without `choices`, so this needs no new code, only a fixture. |
| `response.incomplete`                                                                    | no delta. The stream ends and the text received so far is kept as a complete message. The incomplete reason is not surfaced in this version.                                                   |
| anything else (`response.created`, `response.completed`, part and summary boundaries, …) | ignored                                                                                                                                                                                        |

The accumulator's `StreamedToolCall.id` is the item's `call_id`, which is the value later sent back as `function_call_output.call_id`.

## Testing

- **`packages/providers` unit tests, from recorded fixtures:**
  - Request-shape tests covering every row of the request mapping, including tool calls and tool results.
  - Stream fixtures for text, reasoning summary, a streamed function call, `response.failed`, `error`, and `response.incomplete`.
  - Model-list plan and parser.
- **`codex-auth.ts` unit tests** against a temporary `CODEX_HOME`:
  - Missing file, and API-key `auth_mode`.
  - Fresh token (no refresh).
  - Near-expiry JWT and stale `last_refresh` (both refresh).
  - Rotated refresh token written back with mode `0600`.
  - Refresh failure.
  - Concurrent callers sharing one refresh.
  - No token value in any error message.
- **`ProviderService` tests:**
  - `authorize` adds headers only for `openai_chatgpt`.
  - Token values never appear in snapshots or sanitized errors.
  - `completeChat` collects a stream for this source.
  - The catalog reports `auth` and login state.
- **Live smoke test** (`generation.chatgpt.smoke.test.ts`), gated on `SMOKE_CHATGPT=1` and using the real `CODEX_HOME`. It self-skips like the NanoGPT test and runs, in order:
  1. A model list.
  2. A plain streamed generation.
  3. A generation with one function tool and a forced tool choice, then the `function_call_output` round trip.
  4. One request each with `max_output_tokens`, `temperature`, and `reasoning`, recording which the endpoint rejects.

  Steps 3 and 4 decide whether tools, and which parameters, the implementation plan enables.

## Open questions for the live check

1. Does the endpoint accept function tools and `function_call_output` input without item IDs? This decides agent-mode support.
2. Which of `max_output_tokens`, `temperature`, `top_p`, and `reasoning` does it accept?
3. Does it accept an `originator` other than the Codex CLI's own?
4. Does `client_version` filter the model list, and what value returns the full list?
