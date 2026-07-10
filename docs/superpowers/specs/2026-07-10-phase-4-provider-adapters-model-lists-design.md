# Phase 4 Provider Adapters and Model Lists Design

**Date:** 2026-07-10

**Status:** Approved design, pending implementation plan

**Reference implementation:** SillyTavern commit `29e0df488`

## Context

Phase 3 established a framework-free provider package with OpenAI-compatible request building, SSE parsing, and OpenAI-shaped response normalization. Phase 4 completes the provider core promised by M1: dedicated request adapters for the remaining chat-completion sources, the remaining streaming dialects, and model discovery for all 26 sources.

This phase prioritizes behavioral fidelity to the pinned SillyTavern commit. Provider API changes made after `29e0df488` are deliberately excluded and must be handled as separately reviewed updates.

## Goals

- Build requests for all dedicated sources represented by SillyTavern's 12 dedicated handlers:
  - Anthropic Claude
  - AI21
  - Google AI Studio and Google Vertex AI through one Google handler
  - Mistral AI
  - Cohere
  - DeepSeek
  - AI/ML API
  - xAI
  - Chutes
  - MiniMax
  - Electron Hub
  - Azure OpenAI
- Normalize every streaming and non-streaming text/reasoning dialect used by those handlers.
- Provide executor-independent model discovery: request plans and response normalization for live sources, and pinned static catalogs for sources without a live endpoint.
- Preserve the package boundary: no filesystem reads, Fastify/Express coupling, secret lookup, or provider HTTP calls.
- Pin behavior with request-shape and response-fixture tests derived from SillyTavern commit `29e0df488`.

## Non-goals

- Updating providers to behavior introduced after the pinned commit.
- Legacy text-completion backends.
- Tool calls, JSON schema output, logprobs, prompt caching, media generation, reverse-proxy credential behavior, or SillyTavern UI configuration.
- Performing network requests inside `packages/providers`.
- Live testing every provider. Phase 4 relies on pinned fixtures; NanoGPT remains the available live smoke path.

## Chosen Architecture

The implementation uses isolated fidelity ports rather than a monolithic transliteration or a generic provider engine. Each SillyTavern handler maps to one focused request module, with shared helpers only when the pinned source itself shares behavior. This keeps provider quirks auditable and lets development and verification proceed one small file at a time.

Phase 4 is delivered through three sequential checkpoints:

1. Dedicated request builders
2. Dedicated stream and response dialects
3. Live and static model discovery

The checkpoints share one design and implementation plan because they extend the same public provider API, but each checkpoint must be independently type-safe and testable.

## Public Types and Data Flow

`ProviderChatRequest` remains the output of `buildChatRequest()`. A general HTTP request type is added for model discovery:

```ts
interface ProviderHttpRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: Record<string, unknown> | string;
}

interface ModelListParams {
  apiKey?: string;
  baseUrl?: string;
  extra?: Record<string, unknown>;
}

interface ModelListPlan {
  requests: ProviderHttpRequest[];
  staticModels?: ModelInfo[];
}
```

The later server layer will execute a `ModelListPlan` sequentially and pass decoded response bodies to provider-package parsers. Most live sources produce one `GET /models` request. Azure produces its pinned two-step endpoint/deployment probe. Static sources produce no HTTP requests.

The chat flow remains:

1. The caller injects model, messages, key, base URL, and provider extras into `buildChatRequest()`.
2. The provider package returns URL, method, headers, and JSON body without performing I/O.
3. The caller performs `fetch()`.
4. Streaming responses pass through `parseSseStream()` and `normalizeStreamChunk()`.
5. Non-streaming bodies pass through `parseCompletionResponse()`.

## Dedicated Request Modules

The request directory gains:

```text
request/
  claude.ts
  google.ts
  google-auth.ts
  mistral.ts
  cohere.ts
  ai21.ts
  deepseek.ts
  xai.ts
  aimlapi.ts
  electronhub.ts
  chutes.ts
  minimax.ts
  azure-openai.ts
```

Each builder is a pure function accepting `GenerationParams` and returning `ProviderChatRequest`. It owns the pinned URL, authentication header, prompt conversion, supported generation controls, reasoning controls, and provider-specific validation for its source. `build-request.ts` remains the only public dispatcher.

OpenAI-shaped providers that use dedicated SillyTavern handlers remain dedicated here even if a generic implementation appears possible. This preserves their pinned headers, parameter filtering, endpoint behavior, and model-specific quirks.

Every ported file includes the SillyTavern URL, AGPL-3.0 license, commit hash, original source location, and the M1 omission list.

## Google and Vertex Authentication

Google AI Studio uses the injected API key and the pinned `v1beta` URL behavior.

Vertex Express mode is first-class. It accepts the injected API key and provider extras for region and optional project ID, and constructs the pinned express URL with the API key query parameter.

Vertex Full mode remains experimental and executor-independent:

- `google-auth.ts` validates and signs an injected service-account object into the pinned RS256 JWT assertion.
- It builds, but does not execute, the OAuth token-exchange request.
- It parses a token-exchange response into an access token.
- The caller injects the resulting access token and project ID when building the Vertex chat request.

No service-account JSON is read from disk by the provider package. Time is injectable into JWT creation so tests are deterministic. Unsupported authentication modes and malformed credentials raise `ProviderError` without including credential material in messages.

## Stream and Response Normalization

`normalizeStreamChunk()` gains explicit dialect handling only where the pinned client differs from the existing OpenAI shape:

- Claude content and thinking deltas
- Google candidate parts, including thought-marked parts
- Cohere event-based text deltas
- Any MiniMax or provider-specific reasoning fields present in the pinned implementation

Dedicated sources whose response dialect is OpenAI-compatible continue through the existing fallback. Role-only, finish-only, keepalive, and metadata events return `null`. Provider errors are normalized to `ProviderError` with source and status where available.

`parseCompletionResponse()` reuses the same source-specific extraction rules so streaming and non-streaming results agree. Tool calls, images, citations, signatures, and multi-candidate/swipe state remain excluded.

## Model Discovery

The model directory gains:

```text
models/
  list-models.ts
  static-models.ts
```

`list-models.ts` builds live request plans and normalizes provider response envelopes into `ModelInfo[]`. It preserves pinned special cases, including:

- Google AI Studio filtering to models that support `generateContent`
- Cohere's `models` envelope
- Pollinations' top-level array
- Chutes pricing-field normalization
- Cloudflare Workers AI's `result` envelope and model-name mapping
- Azure's endpoint check followed by deployment-model detection
- Provider-specific URLs, query parameters, and headers from the pinned `/status` handler

Model parsing drops entries without a usable string ID but preserves provider metadata on valid entries. Malformed successful bodies raise `ProviderError`; provider error bodies retain their useful message when present.

`static-models.ts` contains copied-and-attributed catalogs for the six sources identified by the approved M1 plan: Claude, AI21, Vertex AI, Perplexity, MiniMax, and Z.AI. Returned arrays are cloned or readonly so callers cannot mutate the canonical catalog.

## Validation and Errors

- Required keys, base URLs, account IDs, deployment names, API versions, auth inputs, and other provider extras are checked before returning a request.
- Validation errors use `ProviderError` and identify the source.
- Credential values are never included in thrown messages or test snapshots.
- Unknown dedicated sources cannot silently fall back to an incompatible request shape.
- CometAPI remains explicitly disabled because that is the pinned behavior.

## Testing Strategy

Implementation follows red-green-refactor for every behavior:

1. Add a focused failing fixture test.
2. Run only that Vitest file and confirm the expected behavioral failure.
3. Add the minimum adapter or parser logic.
4. Rerun the focused file to green.
5. Run the provider typecheck at each checkpoint.

Request fixtures assert complete URL, method, headers, and body for every dedicated source, including both Google modes and required-config failures. Stream fixtures cover visible text, reasoning, ignorable metadata, malformed events, and provider errors. Model fixtures cover every response envelope and all six static catalogs.

The final gate runs sequentially: `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and the live NanoGPT smoke test. No independent final-review process starts until those commands complete.

## Memory-Safe Execution

- No parallel agents.
- No concurrent Vitest, TypeScript, lint, or build processes.
- Work on one adapter or parser family at a time.
- Use focused Vitest files during red-green cycles.
- Run provider typecheck only at checkpoint boundaries.
- Run repository-wide commands only at final review, sequentially.
- Keep command output bounded and avoid loading the complete SillyTavern handler file into one process or model context.
- Commit each completed checkpoint so a Termux process kill cannot lose reviewed progress.

## Acceptance Criteria

- `buildChatRequest()` produces a pinned request or a specific validation error for all 26 sources.
- Dedicated request fixtures cover all 13 dedicated source names represented by the 12 SillyTavern handlers.
- Streaming and non-streaming text/reasoning normalization covers every pinned provider dialect in Phase 4 scope.
- Model discovery supports all live sources and returns pinned catalogs for the six static sources.
- No provider package code reads the filesystem, reads secrets, or performs provider HTTP requests.
- Attribution headers identify SillyTavern commit `29e0df488` in every derived file.
- Focused tests, provider typecheck, final repository gates, and the NanoGPT live smoke test pass.
