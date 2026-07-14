# Phase 8 Provider Settings and Keys Web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status: as-built record.** Reconstructed on 2026-07-14 after the implementation shipped in PR #10 (merged as `29e7ee2`). This plan did not drive the work; checkboxes are marked complete retroactively and each task maps to a shipped commit. The governing spec is `docs/superpowers/specs/2026-07-13-phase-8-provider-settings-web-design.md`.

**Goal:** Deliver the provider key manager, the descriptor-driven provider configuration editor, notebook provider defaults, and the minimal chat create/select shell on top of the Phase 6 APIs and Phase 7 workspace.

**Architecture:** `/settings` becomes the masked multi-key manager fed by the provider catalog. One reusable `ProviderConfigEditor` renders provider-specific fields generically from `PROVIDER_META` descriptors and validates output against `providerConfigSchema`; a dialog wrapper serves both notebook defaults (persisted via `PATCH /api/notebooks/:id { settings }`) and complete per-chat overrides. The chat region gains a functional list/create/select/rename/delete shell with an explicit "messages arrive in Phase 9" placeholder — no new routes, server contracts, or shared schemas.

**Tech Stack:** React 19, React Router 7, TypeScript, Zod schemas from `@worldbookllm/shared`, Vitest, Testing Library.

## Global Constraints

- `apps/web` only: server routes, shared schemas, and `packages/providers` are frozen.
- Secret fields are write-only; the UI renders masked server state and never retains submitted values.
- Chat provider precedence is fixed: a complete non-null override wins; `providerOverride: null` restores notebook inheritance.
- No messages, prompt submission, SSE consumption, or streaming UI — Phase 9 owns them.

---

### Task 1: Web API client extensions — commit `493a7c1`

**Files:**

- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/test/createTestClient.ts`
- Test: `apps/web/src/api/client.test.ts`

**Interfaces:**

- Produces `getProviderCatalog`, `listModels`, `testConnection`, `getSecrets`, `createSecret`, `activateSecret`, `deleteSecret`, `listChats`, `createChat`, `getChat`, `updateChat`, and `deleteChat` on `ApiClient`, all schema-validated.

- [x] Failing client tests for each method's URL, verb, body, 201/204 handling, and error mapping.
- [x] Implement the methods over the existing generic request helper.
- [x] Focused web API tests pass.

### Task 2: Settings page and provider config editor — commit `174dbbd`

**Files:**

- Create: `apps/web/src/settings/SettingsPage.tsx`
- Create: `apps/web/src/providers/ProviderConfigEditor.tsx`
- Create: `apps/web/src/providers/ProviderConfigDialog.tsx`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/src/settings/SettingsPage.test.tsx`
- Test: `apps/web/src/providers/ProviderConfigEditor.test.tsx`

**Interfaces:**

- Produces the masked key manager (add / make active / delete per provider) rendered from catalog + secret state.
- Produces the descriptor-driven editor: provider select, passive key-status indicator, conditional base URL, generic extra fields, Load models with free-text fallback, advisory connection test, schema-gated submit.

- [x] Failing tests for key management flows and editor field rendering/validation.
- [x] Implement page, editor, and dialog wrapper.
- [x] Focused tests pass.

### Task 3: Notebook defaults and chat shell — commit `80d38a6`

**Files:**

- Create: `apps/web/src/chats/ChatPanel.tsx`
- Modify: `apps/web/src/notebooks/NotebookWorkspace.tsx`
- Modify: `apps/web/src/notebooks/notebook-workspace-context.ts`
- Test: `apps/web/src/chats/ChatPanel.test.tsx`

**Interfaces:**

- Produces the notebook provider header + `Configure provider` dialog persisting `Notebook.settings`, `replaceNotebook(notebook)` on the workspace context, and the chat list/create/select/rename/delete shell with override editing and the Phase 9 placeholder.

- [x] Failing tests for defaults persistence, chat CRUD, and override precedence display.
- [x] Implement panel and workspace integration.
- [x] Focused tests pass.

### Task 4: Remove the settings placeholder — commit `bc3a676`

**Files:**

- Delete: `apps/web/src/pages/SettingsPlaceholder.tsx`

- [x] Route `/settings` serves the real page; placeholder and its references removed.

### Task 5: Review fixes and verification — commit `0e2b687`

**Files:**

- Modify: `apps/web/src/providers/ProviderConfigEditor.tsx`
- Modify: `apps/web/src/chats/ChatPanel.tsx`
- Modify: `apps/web/src/settings/SettingsPage.tsx`

- [x] Vertex AI auth options rendered from catalog descriptors instead of hardcoding.
- [x] Mutation errors split from refresh errors; busy state while clearing an override.
- [x] All repository gates (`lint`, `format:check`, `typecheck`, `test`, `build`) green on PR #10.
