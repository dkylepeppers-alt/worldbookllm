# ADR 0005 — Port SillyTavern's provider layer; relicense to AGPL-3.0

**Status:** accepted · 2026-07-10 · supersedes the license choice in the M0 setup

## Context

Genuine model agnosticism (the roadmap's provider-layer milestone) means encoding a large amount of per-provider knowledge: request URLs and auth headers, payload quirks, message-format conversion (Claude, Gemini, Cohere, Mistral, …), reasoning/thinking parameters, streaming dialects, and model-list endpoints. SillyTavern has already built and battle-tested exactly this for 26 chat-completion sources, and its code is available locally. Writing it from scratch would re-derive years of accumulated provider quirks.

SillyTavern is licensed AGPL-3.0. Incorporating its code into an MIT project is not permitted; the combined work must be AGPL-3.0.

## Decision

1. Port SillyTavern's chat-completion provider layer (request building from `src/endpoints/backends/chat-completions.js`, message conversion from `src/prompt-converters.js`, stream-delta extraction from `public/scripts/openai.js`, secret storage from `src/endpoints/secrets.js`) into a framework-free TypeScript package, `packages/providers`, plus a server-side secret store.
2. Relicense worldbookllm from MIT to **AGPL-3.0-only**, effective before any ported code enters the repository.
3. Every file containing ported logic carries a header naming SillyTavern, its license, and the source commit (`29e0df488`), plus a list of features deliberately not ported.
4. Only the modern chat-completions family is ported; SillyTavern's legacy text-completion backends (Kobold, Mancer, Horde, …) are out of scope.

## Rationale

- The provider layer is the highest-risk, highest-effort part of the product promise ("choose your model, like SillyTavern"); reusing proven code converts that risk into a mechanical, testable port.
- AGPL fits the project: a free, self-hosted creative tool in the same ecosystem as SillyTavern. Anyone operating a modified hosted version must share their changes — aligned with the project's local-first, user-owned-data values.
- Clean isolation in `packages/providers` keeps the derived-code boundary auditable and the rest of the codebase original.

## Consequences

- The project cannot later relicense to a permissive license without removing/rewriting the ported code.
- Ported code is translated (Express JS → framework-free strict TS), not copied verbatim; behavior fidelity is pinned by unit tests rather than shared code.
- Future syncs with upstream SillyTavern improvements are possible by diffing against the recorded commit.
