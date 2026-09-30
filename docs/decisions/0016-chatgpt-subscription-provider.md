# ADR 0016 — ChatGPT subscription provider through the Codex CLI login

**Status:** proposed · 2026-09-30

## Context

Every provider in `packages/providers` today is authenticated with an API key held in the server's secret store (ADR 0005). Writers who already pay for a ChatGPT plan have asked to use that plan instead of paying separately for API access. OpenAI's Codex CLI signs a user in with their ChatGPT account and stores OAuth tokens in `~/.codex/auth.json` (or `$CODEX_HOME/auth.json`). With those tokens, the Codex backend at `https://chatgpt.com/backend-api/codex` accepts OpenAI Responses API requests (`POST /responses`) that bill against the plan. Marinara Engine (AGPL-3.0, commit `12a0acd5b7823abeaf3e05ad39a3a07d957e9ffc`) ships this as its "OpenAI ChatGPT subscription login" provider. That gives us a working reference for the token file, the refresh request, the extra headers, and the endpoint's constraints.

This source differs from the existing 26 in three ways:

- **Not in the SillyTavern baseline.** It has no counterpart at SillyTavern `29e0df488`, so ADR 0005's port-fidelity rule has nothing to pin it to.
- **Credentials come from a file.** The credential is a token file that the server must read and refresh, not a key the user pastes in.
- **The wire format is Responses, not Chat Completions.** Its request shape and streaming events differ from every dialect `packages/providers` normalizes today.

The same request also covered a Claude subscription provider built on the Claude Agent SDK. That provider has no HTTP request for `packages/providers` to build, so it needs a separate decision and is deferred. Point 7 records the one constraint already settled for it.

## Decision

1. **Add a 27th source, `openai_chatgpt`** ("ChatGPT (subscription via Codex login)"), to `ChatCompletionSource`, `PROVIDER_SOURCES`, `CHAT_COMPLETION_SOURCES`, and `PROVIDER_META`, with `family: 'dedicated'` and `modelSource: 'live'`.
2. **Build and normalize the Responses dialect in `packages/providers`, which stays pure.**
   - A new request builder produces `POST {base}/responses`. It always sets `stream: true`, `store: false`, and a non-empty `instructions`.
   - The stream normalizer and `ToolCallAccumulator` learn the `response.*` event family.
   - The model-list plan targets `GET {base}/models?client_version=…`.
   - The access token and ChatGPT account ID arrive as injected parameters, the same way API keys do today.
3. **Credentials live in the server, not the secret store.** A new `apps/server` module reads the Codex auth file and refreshes the access token when it is near expiry. It writes the rotated tokens back to the same file with mode `0600`, and at most one refresh runs at a time. `ProviderService` asks this module for credentials when the source is `openai_chatgpt` and asks the secret store for every other source. The user signs in by running `codex login` on the server's machine. worldbookllm never runs an OAuth flow itself.
4. **Always stream.** The Codex endpoint only streams. Internal non-streaming completions (`completeChat`, used by source organization) collect the streamed deltas for this source instead of calling `fetchJson`.
5. **Adapted code carries a Marinara Engine attribution header.** Files adapted from Marinara name Marinara Engine, AGPL-3.0, and the commit above, in the same form ADR 0005 prescribes for SillyTavern ports. Behavior is pinned by unit tests and fixtures, as for every other source.
6. **Tool calling is enabled only after a live check.** `openai_chatgpt` joins the tool-capable set, and so gets the agent loop (ADR 0015), only once a live smoke test confirms that the Codex endpoint accepts function tools. Until then it runs as plain chat. Marinara never sends tools on this path, so it offers no evidence either way.
7. **A future Claude subscription provider runs without tools.** When it is built, it is not in the tool-calling set. Under ADR 0015's existing rule, providers without tool calling get plain chat, and agent mode reports that the provider cannot run the agent.

## Rationale

Reading the Codex CLI's own login keeps worldbookllm out of the OAuth business. There is no client registration, no browser redirect, and no token entry form, and the user's sign-in stays managed by OpenAI's own tool. Putting the Responses dialect in `packages/providers` preserves the boundary that makes that package testable: it still only describes requests and interprets responses. The token file's I/O lands in the server beside the secret store, which is where the project already keeps credential handling. Adapting Marinara's working implementation turns this into a fixture-tested port, the same way ADR 0005 did for SillyTavern. The alternative was reverse-engineering the endpoint from the Codex CLI's source.

## Consequences

- **Worse failure modes:** this source depends on an undocumented endpoint and on OpenAI's willingness to accept a non-Codex client. It can break without notice, and it has none of the stability of the documented API sources.
- **Shared token file:** worldbookllm and the Codex CLI now share one file. The refresh token rotates on use, so the file must be writable by the server. A read-only copy would leave the Codex CLI holding a dead refresh token after worldbookllm's first refresh.
- **Docker:** a Docker deployment must bind-mount the host's Codex directory into the container, writable, or set `CODEX_HOME` to a mounted path. `docs/DEPLOYMENT.md` gains that recipe.
- **Settings page:** the Settings page shows sign-in status for this source instead of an API-key list, so the provider catalog gains a field describing how each source authenticates.
- **Maintenance:** `packages/providers` carries code from a second upstream, so future upstream syncs have two reference points to diff against.
