# Phase 7 Notebook and Source Web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the mobile-first notebook and Markdown-source workspace on top of the tested Phase 6 APIs.

**Architecture:** React Router owns meaningful destinations while a shared notebook workspace keeps the source collection and last reader selection alive. A fetch-backed, schema-validating `ApiClient` is injected through React context; server responses remain authoritative. Plain CSS implements the responsive cartographer-studio system without a component framework.

**Tech Stack:** React 19, React Router, TypeScript, Zod schemas from `@worldbookllm/shared`, react-markdown, remark-gfm, Vitest, Testing Library, Vite.

## Global Constraints

- Keep Phase 7 thin: no provider management, functional chat, source editing, or browser persistence.
- Prioritize phone screens down to 320px; progressively reveal two- and three-region layouts.
- Use nested routes for sources and local state for dialogs and rendered/raw display.
- Escape embedded HTML in Markdown and expose the exact stored text through Raw mode.
- Run installs, tests, typechecks, and builds sequentially with one worker where supported.

---

### Task 1: Shared response schemas and typed API client

**Files:**

- Modify: `packages/shared/src/notebooks.ts`
- Modify: `packages/shared/src/sources.ts`
- Create: `packages/shared/src/api-errors.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/data-schemas.test.ts`
- Create: `apps/web/src/api/client.ts`
- Test: `apps/web/src/api/client.test.ts`

**Interfaces:**

- Produces shared `notebookListSchema`, `sourceMetadataListSchema`, and `apiErrorSchema`.
- Produces `ApiClient`, `createApiClient(fetchImpl?)`, and `ApiClientError` for all notebook/source operations.

- [ ] Add failing schema tests for list responses and validation/non-validation errors.
- [ ] Run the focused shared test and confirm the new exports are missing.
- [ ] Implement and export the minimum schemas and inferred types.
- [ ] Run the focused shared test and confirm it passes.
- [ ] Add failing client tests for parsed success, request bodies, 204, API errors, malformed responses, network failure, and abort propagation.
- [ ] Run the focused web test and confirm the client module is missing.
- [ ] Implement the generic request helper and the eight notebook/source methods.
- [ ] Run the focused API tests and confirm they pass.

### Task 2: Router, API context, and application shell

**Files:**

- Modify: `apps/web/package.json`
- Modify: `apps/web/src/main.tsx`
- Modify: `apps/web/src/App.tsx`
- Create: `apps/web/src/api/ApiContext.tsx`
- Create: `apps/web/src/layout/AppShell.tsx`
- Create: `apps/web/src/pages/NotFoundPage.tsx`
- Create: `apps/web/src/pages/SettingsPlaceholder.tsx`
- Test: `apps/web/src/App.test.tsx`

**Interfaces:**

- Consumes the Task 1 `ApiClient`.
- Produces stable routes `/`, `/notebooks/:notebookId`, `/notebooks/:notebookId/sources/:sourceId`, `/settings`, and `*`.

- [ ] Replace the shell test with failing route and landmark tests using `MemoryRouter` and an injected fake client.
- [ ] Run the focused test and confirm the routes do not exist.
- [ ] Add dependencies and implement the API provider, nested route tree, shell, placeholders, and catch-all page.
- [ ] Run the focused test and confirm routing passes.

### Task 3: Notebook workflows

**Files:**

- Create: `apps/web/src/notebooks/NotebookListPage.tsx`
- Create: `apps/web/src/notebooks/NotebookWorkspace.tsx`
- Create: `apps/web/src/components/ConfirmDialog.tsx`
- Create: `apps/web/src/components/RequestState.tsx`
- Test: `apps/web/src/notebooks/NotebookListPage.test.tsx`
- Test: `apps/web/src/notebooks/NotebookWorkspace.test.tsx`

**Interfaces:**

- Notebook creation navigates to `/notebooks/:id`.
- `NotebookWorkspace` supplies notebook, sources, reload, and last-selected-source state to child reader routes.

- [ ] Add failing tests for loading, empty, retry, create validation/success, inline rename, confirmed deletion, and notebook 404.
- [ ] Run both focused files and confirm the workflows are absent.
- [ ] Implement resource lifecycle hooks and the minimum notebook pages/components.
- [ ] Run both focused files and confirm the workflows pass.

### Task 4: Source paste, list, reader, and deletion

**Files:**

- Create: `apps/web/src/sources/SourcePasteDialog.tsx`
- Create: `apps/web/src/sources/SourceList.tsx`
- Create: `apps/web/src/sources/SourceViewer.tsx`
- Create: `apps/web/src/sources/ReaderRoute.tsx`
- Test: `apps/web/src/sources/SourceWorkspace.test.tsx`

**Interfaces:**

- Source creation navigates to `/notebooks/:notebookId/sources/:sourceId`.
- Reader defaults to rendered GFM, offers Raw mode, and returns to the source list after active-source deletion.

- [ ] Add failing tests for empty/loading/error states, paste validation/recovery, creation, GFM rendering, raw toggle reset, escaped HTML, reader 404, and confirmed deletion.
- [ ] Run the focused test and confirm source behavior is absent.
- [ ] Implement the paste dialog, source list, route reader, metadata, Markdown rendering, and deletion behavior.
- [ ] Run the focused source test and confirm it passes.

### Task 5: Mobile-first cartographer studio styling

**Files:**

- Create: `apps/web/src/styles.css`
- Modify: `apps/web/src/main.tsx`
- Modify: `apps/web/src/layout/AppShell.tsx`
- Modify: `apps/web/src/notebooks/NotebookWorkspace.tsx`
- Test: `apps/web/src/App.test.tsx`

**Interfaces:**

- Phone navigation exposes Notebooks, Sources, and Reader with minimum 44px targets.
- Tablet shows source list and reader; wide desktop adds the reserved Chat region.

- [ ] Add failing semantic tests for mobile navigation labels, disabled Reader state, dialogs, and accessible status/error content.
- [ ] Run focused tests and confirm missing semantics.
- [ ] Implement design tokens, typography, coordinate labels, source spines, responsive grids, focus states, safe-area handling, and reduced-motion behavior.
- [ ] Run all web tests with one worker.

### Task 6: Documentation, verification, and smoke test

**Files:**

- Modify: `docs/ROADMAP.md` only if the repository convention records completed phases there.

- [ ] Run Prettier on changed files and inspect the diff for unrelated edits.
- [ ] Run shared tests, web tests with one worker, lint, sequential typecheck, sequential full tests, format check, and sequential build.
- [ ] Start server and web sequentially, then exercise notebook and source APIs plus routed HTML assets without invoking a model provider.
- [ ] Inspect phone and desktop screenshots if a browser-capable local tool is available; otherwise verify responsive CSS and DOM behavior through automated tests.
- [ ] Review every Phase 7 acceptance item against the diff and commit intentional changes.
