# Phase 4 Provider Adapters and Model Lists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the framework-free provider core with pinned dedicated request builders, provider stream dialects, and model discovery for all 26 chat-completion sources.

**Architecture:** Preserve the public dispatcher and isolate each SillyTavern handler in a focused pure module. Model discovery produces executor-independent HTTP plans or cloned static catalogs; streaming and non-streaming normalization share source-specific extraction rules. Execute all red-green cycles and repository gates sequentially to stay within Termux memory limits.

**Tech Stack:** TypeScript 5.9 strict/NodeNext, Node 20 built-ins, Vitest 3, pnpm 9, SillyTavern commit `29e0df488` as the behavioral reference.

## Global Constraints

- Match SillyTavern commit `29e0df488`; defer newer provider behavior.
- Keep `packages/providers` free of filesystem reads, secret lookup, Express/Fastify, and provider HTTP execution.
- Every derived file names SillyTavern, AGPL-3.0, the pinned commit, source location, and M1 omissions.
- Do not port tools, JSON schema, logprobs, prompt caching, media, reverse proxies, citations, or multi-swipe state.
- Use TDD: observe each focused test fail for the missing behavior before production edits.
- Run only one Vitest, TypeScript, lint, format, build, or smoke-test process at a time.
- Commit and push each green checkpoint before starting the next.

---

### Task 1: Shared HTTP, model-list, and provider-extra contracts

**Files:**

- Modify: `packages/providers/src/types.ts`
- Modify: `packages/providers/src/sources.ts`
- Create: `packages/providers/src/request/provider-helpers.ts`
- Test: `packages/providers/src/request/__tests__/provider-helpers.test.ts`

**Interfaces:**

- Consumes: `ChatCompletionSource`, `ProviderError`, `ProviderMeta`.
- Produces: `ProviderHttpRequest`, `ModelListParams`, `ModelListPlan`, `requireApiKey()`, `extraString()`, `extraBoolean()`, `compactObject()`, and `chatCompletionsUrl()`.

- [ ] **Step 1: Write the failing helper and metadata tests**

```ts
import { describe, expect, it } from 'vitest';
import { ProviderError } from '../../types.js';
import {
  chatCompletionsUrl,
  compactObject,
  extraString,
  requireApiKey,
} from '../provider-helpers.js';

describe('provider helpers', () => {
  it('normalizes chat completion URLs and omits undefined values', () => {
    expect(chatCompletionsUrl('https://example.test/v1/')).toBe(
      'https://example.test/v1/chat/completions',
    );
    expect(compactObject({ present: 0, absent: undefined })).toEqual({ present: 0 });
  });

  it('validates injected keys and trimmed provider extras', () => {
    expect(extraString({ region: ' global ' }, 'region')).toBe('global');
    expect(() => requireApiKey('claude', undefined)).toThrow(
      new ProviderError('Anthropic Claude requires an API key.', 'claude'),
    );
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter @worldbookllm/providers exec vitest run src/request/__tests__/provider-helpers.test.ts`

Expected: FAIL because `provider-helpers.js` and the new exported contracts do not exist.

- [ ] **Step 3: Add the exact shared contracts and helpers**

```ts
export interface ProviderHttpRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: Record<string, unknown> | string;
}

export interface ModelListParams {
  apiKey?: string;
  baseUrl?: string;
  extra?: Record<string, unknown>;
}

export interface ModelListPlan {
  requests: ProviderHttpRequest[];
  staticModels?: ModelInfo[];
}
```

Implement the helpers as total pure functions. Extend Vertex metadata with `authMode`, `projectId`, and `region`, while preserving the existing Azure, MiniMax, and Workers AI extras.

- [ ] **Step 4: Run the focused test and provider typecheck**

Run sequentially:

```bash
pnpm --filter @worldbookllm/providers exec vitest run src/request/__tests__/provider-helpers.test.ts
pnpm --filter @worldbookllm/providers typecheck
```

Expected: both exit 0.

### Task 2: Claude and Google-native request builders

**Files:**

- Create: `packages/providers/src/request/claude.ts`
- Create: `packages/providers/src/request/google.ts`
- Create: `packages/providers/src/request/google-auth.ts`
- Create: `packages/providers/src/request/__tests__/claude.test.ts`
- Create: `packages/providers/src/request/__tests__/google.test.ts`
- Modify: `packages/providers/src/request/build-request.ts`

**Interfaces:**

- Consumes: `convertClaudeMessages()`, `convertGooglePrompt()`, `calculateClaudeBudgetTokens()`, `calculateGoogleBudgetTokens()`, `GenerationParams`, and Task 1 helpers.
- Produces: `buildClaudeRequest()`, `buildGoogleRequest()`, `createVertexJwt()`, `buildVertexTokenRequest()`, and `parseVertexTokenResponse()`.

- [ ] **Step 1: Write Claude request fixtures**

Cover API-key validation, `/v1/messages`, `x-api-key`, pinned `anthropic-version`, converted system/messages, streaming, stop sequences, assistant prefill, and pinned thinking-budget fields. Assert complete request equality.

- [ ] **Step 2: Verify Claude RED**

Run: `pnpm --filter @worldbookllm/providers exec vitest run src/request/__tests__/claude.test.ts`

Expected: FAIL because the dispatcher reports Claude as unimplemented.

- [ ] **Step 3: Port the Claude handler minimally and verify GREEN**

Implement only fields present in both `GenerationParams` and the Phase 4 design. Run the Claude file until every fixture passes.

- [ ] **Step 4: Write Google AI Studio and Vertex fixtures**

```ts
it.each([
  [
    'makersuite',
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?key=test-key&alt=sse',
  ],
  [
    'vertexai',
    'https://us-central1-aiplatform.googleapis.com/v1/publishers/google/models/gemini-2.5-flash:streamGenerateContent?key=test-key&alt=sse',
  ],
] as const)('builds pinned %s generation URLs', (source, url) => {
  expect(buildChatRequest(source, googleParams).url).toBe(url);
});
```

Also cover system-instruction conversion, safety settings, generation config, thinking config, Express project URLs, Full-mode access tokens, deterministic JWT claims/signature shape, token-exchange request, and redacted authentication failures.

- [ ] **Step 5: Verify Google RED, implement, and verify GREEN**

Run only `src/request/__tests__/google.test.ts` during the cycle. `google-auth.ts` may use `node:crypto` for RS256 signing but must return the OAuth exchange request rather than execute it.

- [ ] **Step 6: Run native-adapter checkpoint verification**

Run sequentially:

```bash
pnpm --filter @worldbookllm/providers exec vitest run src/request/__tests__/claude.test.ts
pnpm --filter @worldbookllm/providers exec vitest run src/request/__tests__/google.test.ts
pnpm --filter @worldbookllm/providers typecheck
```

Expected: all exit 0.

### Task 3: AI21, Mistral, and Cohere request builders

**Files:**

- Create: `packages/providers/src/request/ai21.ts`
- Create: `packages/providers/src/request/mistral.ts`
- Create: `packages/providers/src/request/cohere.ts`
- Create: `packages/providers/src/request/__tests__/ai21.test.ts`
- Create: `packages/providers/src/request/__tests__/mistral.test.ts`
- Create: `packages/providers/src/request/__tests__/cohere.test.ts`
- Modify: `packages/providers/src/request/build-request.ts`

**Interfaces:**

- Consumes: `convertAI21Messages()`, `convertMistralMessages()`, `convertCohereMessages()`, Task 1 helpers.
- Produces: `buildAi21Request()`, `buildMistralRequest()`, `buildCohereRequest()`.

- [ ] **Step 1: Add complete pinned request fixtures for AI21**

Assert URL, bearer authentication, converted messages, model, sampling controls, token limit, stop sequences, and streaming behavior. Verify RED, port the handler, then verify GREEN.

- [ ] **Step 2: Add complete pinned request fixtures for Mistral**

Assert the pinned endpoint, bearer authentication, Mistral message conversion, safe-prompt and random-seed behavior where represented by `GenerationParams`, and omission of unsupported values. Verify RED, implement, and verify GREEN.

- [ ] **Step 3: Add complete pinned request fixtures for Cohere**

Assert the pinned v2 chat endpoint, bearer authentication, Cohere message conversion, preamble/history/message placement, generation controls, and stream flag. Verify RED, implement, and verify GREEN.

- [ ] **Step 4: Run the focused files and provider typecheck sequentially**

Expected: all focused tests and typecheck exit 0.

### Task 4: Remaining OpenAI-shaped dedicated builders

**Files:**

- Create: `packages/providers/src/request/deepseek.ts`
- Create: `packages/providers/src/request/xai.ts`
- Create: `packages/providers/src/request/aimlapi.ts`
- Create: `packages/providers/src/request/electronhub.ts`
- Create: `packages/providers/src/request/chutes.ts`
- Create: `packages/providers/src/request/__tests__/openai-shaped-dedicated.test.ts`
- Modify: `packages/providers/src/request/build-request.ts`

**Interfaces:**

- Consumes: Task 1 helpers, prompt converters selected by the pinned handler, and `GenerationParams`.
- Produces: one `build*Request()` function per source.

- [ ] **Step 1: Write a table-driven full-request fixture for all five sources**

The table must assert each pinned base URL, headers, message conversion, supported sampling/token parameters, reasoning fields, and model-specific branches. Include missing-key errors for every source.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @worldbookllm/providers exec vitest run src/request/__tests__/openai-shaped-dedicated.test.ts`

Expected: each source fails at the dispatcher as unimplemented.

- [ ] **Step 3: Implement one source at a time**

After each module is added, rerun the same focused file with `-t` for that source. Do not run multiple Vitest processes.

- [ ] **Step 4: Verify the complete focused file and provider typecheck**

Expected: both exit 0.

### Task 5: MiniMax and Azure request builders; complete dispatcher

**Files:**

- Create: `packages/providers/src/request/minimax.ts`
- Create: `packages/providers/src/request/azure-openai.ts`
- Create: `packages/providers/src/request/__tests__/minimax.test.ts`
- Create: `packages/providers/src/request/__tests__/azure-openai.test.ts`
- Modify: `packages/providers/src/request/build-request.ts`
- Modify: `packages/providers/src/index.ts`

**Interfaces:**

- Consumes: Task 1 helpers and `GenerationParams.extra` values `region`, `deploymentName`, and `apiVersion`.
- Produces: `buildMinimaxRequest()`, `buildAzureOpenAiRequest()`, and a dispatcher supporting every `ChatCompletionSource`.

- [ ] **Step 1: Write MiniMax international/CN and reasoning fixtures**

Verify RED, port the pinned handler, and verify GREEN.

- [ ] **Step 2: Write Azure URL/header/body and incomplete-config fixtures**

```ts
expect(buildChatRequest('azure_openai', azureParams)).toMatchObject({
  url: 'https://example.openai.azure.com/openai/deployments/story/chat/completions?api-version=2025-01-01-preview',
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'api-key': 'test-key' },
});
```

Verify RED, implement robust URL construction with the `URL` API, then verify GREEN.

- [ ] **Step 3: Assert all 26 sources have an intentional dispatch result**

The test iterates `CHAT_COMPLETION_SOURCES`; valid fixture inputs must return a request except CometAPI, which must retain its pinned disabled error.

- [ ] **Step 4: Run request checkpoint tests, typecheck, commit, and push**

Run each request test file sequentially, then provider typecheck. Commit only after green:

```bash
git commit -m "feat(providers): add dedicated request adapters"
git push origin main
```

### Task 6: Dedicated streaming and non-streaming dialects

**Files:**

- Modify: `packages/providers/src/stream/normalize.ts`
- Modify: `packages/providers/src/stream/normalize.test.ts`
- Modify: `packages/providers/src/response.test.ts`

**Interfaces:**

- Consumes: `normalizeStreamChunk()`, `parseCompletionResponse()`.
- Produces: pinned Claude, Google, Cohere, and MiniMax extraction with the existing OpenAI fallback.

- [ ] **Step 1: Add failing Claude fixtures**

Cover `content_block_delta` text, `thinking_delta` reasoning, message stop metadata, and Claude error envelopes.

- [ ] **Step 2: Implement Claude extraction and verify GREEN**

Run only `src/stream/normalize.test.ts -t Claude` until green.

- [ ] **Step 3: Add failing Google candidate-part fixtures**

Cover visible parts, `thought: true` parts, empty candidate metadata, and Google error envelopes. Implement and verify green.

- [ ] **Step 4: Add failing Cohere and MiniMax fixtures**

Cover pinned event names/paths, visible text, reasoning where present, and finish/metadata events. Implement one dialect at a time and verify green.

- [ ] **Step 5: Add matching non-stream response fixtures**

Assert `parseCompletionResponse()` produces the same `{ text, reasoning? }` semantics for complete Claude, Google, Cohere, and MiniMax bodies.

- [ ] **Step 6: Run stream checkpoint verification, commit, and push**

Run stream tests, response tests, and provider typecheck sequentially. Commit:

```bash
git commit -m "feat(providers): normalize dedicated response dialects"
git push origin main
```

### Task 7: Static model catalogs

**Files:**

- Create: `packages/providers/src/models/static-models.ts`
- Create: `packages/providers/src/models/static-models.test.ts`

**Interfaces:**

- Produces: `getStaticModels(source): ModelInfo[] | undefined` for Claude, AI21, Vertex AI, Perplexity, MiniMax, and Z.AI.

- [ ] **Step 1: Add failing catalog tests**

Assert the exact ordered IDs transcribed from commit `29e0df488`, undefined for live sources, and defensive cloning by mutating one result and checking the next call.

- [ ] **Step 2: Verify RED, add attributed readonly catalogs, and verify GREEN**

Run only `src/models/static-models.test.ts` during the cycle.

### Task 8: Live model-list request plans and response parsing

**Files:**

- Create: `packages/providers/src/models/list-models.ts`
- Create: `packages/providers/src/models/list-models.test.ts`
- Modify: `packages/providers/src/index.ts`

**Interfaces:**

- Consumes: `ModelListParams`, `ModelListPlan`, `ProviderHttpRequest`, `getStaticModels()`.
- Produces: `buildModelListPlan(source, params)` and `parseModelListResponse(source, data, step?)`.

- [ ] **Step 1: Write failing request-plan fixtures**

Cover all live model sources, exact pinned URLs/query parameters/headers, missing configuration, Google filtering, Workers AI account IDs, and Azure's ordered GET-models/POST-deployment probe.

- [ ] **Step 2: Verify RED and implement request-plan construction**

Run only `src/models/list-models.test.ts -t plan` until green.

- [ ] **Step 3: Write failing envelope-normalization fixtures**

```ts
expect(parseModelListResponse('cohere', { models: [{ name: 'command-r' }] })).toEqual([
  expect.objectContaining({ id: 'command-r' }),
]);
expect(parseModelListResponse('pollinations', [{ name: 'openai' }])).toEqual([
  expect.objectContaining({ id: 'openai' }),
]);
expect(parseModelListResponse('workers_ai', { result: [{ name: '@cf/model' }] })).toEqual([
  expect.objectContaining({ id: '@cf/model' }),
]);
```

Also cover Google `generateContent` filtering, Chutes pricing normalization, Azure detected-model extraction, malformed success bodies, and provider errors.

- [ ] **Step 4: Implement parsing and verify GREEN**

Run the focused model-list file, then static-model tests and provider typecheck sequentially.

- [ ] **Step 5: Commit and push the model checkpoint**

```bash
git commit -m "feat(providers): add model discovery plans and catalogs"
git push origin main
```

### Task 9: Attribution, public API, review, and low-memory final gate

**Files:**

- Modify: `packages/providers/src/index.ts`
- Review: every Phase 4 file
- Update: `/home/dev/.claude/tasks/3d065225-2722-4186-b181-578eb9721459/4.json`

**Interfaces:**

- Produces: the complete public Phase 4 API and completed phase checkpoint.

- [ ] **Step 1: Verify attribution and scope mechanically**

Use `rg` to confirm every derived production file contains `29e0df488`, and inspect `git diff` for filesystem, secret, fetch, Express, or Fastify coupling.

- [ ] **Step 2: Run a read-only final code review**

Review pinned fidelity, strict TypeScript behavior, credential redaction, full source coverage, stream semantics, model envelope handling, and test quality. Fix every confirmed finding with a failing regression test first.

- [ ] **Step 3: Run the complete final gate sequentially**

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
SMOKE_NANOGPT_KEY="$key" pnpm --filter @worldbookllm/providers exec vitest run src/nanogpt.smoke.test.ts
```

Load `key` from the already-authorized SillyTavern secret store without printing it. Every command must exit 0 before completion is claimed.

- [ ] **Step 4: Commit/push review fixes and verify the remote SHA**

Commit any review-only changes, push `main`, compare `git rev-parse HEAD` with `git ls-remote origin refs/heads/main`, and require a clean worktree.

- [ ] **Step 5: Mark Phase 4 completed**

Change the persisted Phase 4 task status from `in_progress` to `completed` only after the remote and clean-tree checks pass.
