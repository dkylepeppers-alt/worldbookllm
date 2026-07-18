# Roadmap

Milestones are ordered so that every one ends with a working, demoable app. Each has a goal and explicit "done when" criteria.

## M0 — Repository foundation ✅

**Goal:** a correctly set up repository: tooling, structure, CI, and design docs — no feature code.

**Done when:**

- pnpm workspace monorepo with `apps/server` (Fastify), `apps/web` (React + Vite), `packages/shared`
- `pnpm lint / typecheck / test / build` all pass locally and in CI
- `pnpm dev` boots both processes; the web shell reaches the server through the Vite proxy
- README, ARCHITECTURE, ROADMAP, and ADRs committed

**Later addition (2026-07-15):** production deployment was never fully closed out — `apps/server` now serves the built web app single-origin as ADR 0002 always intended, the app is an installable PWA, and `docs/DEPLOYMENT.md` covers environment variables, the Docker/compose path, and a reverse-proxy/HTTPS setup. See ADR 0010.

## M1 — Walking skeleton + full provider layer ✅

**Goal:** the first usable app — create a notebook, add sources, chat with them — built on genuine model agnosticism from day one, via a provider layer ported from SillyTavern (see ADR 0005).

**Status (2026-07-14):** complete and operator-verified, including the mandatory live NanoGPT E2E and server smoke paths. All nine phases are implemented: the server, notebook/source workspace, provider settings, streaming chat UI, stop/interrupted behavior, and complete walking-skeleton E2E. See `docs/superpowers/specs/2026-07-10-m1-phases-6-9-contracts-design.md` for the phase contracts.

**Later change (2026-07-18):** the per-notebook default / per-chat override provider layering below was never used as a layering — every workspace pointed every notebook at the same provider. Replaced with a single global provider/model setting configured on the Settings page (ADR 0013); `Notebook.settings` and `Chat.providerOverride` are gone.

**Scope:**

- Relicense to AGPL-3.0 (prerequisite for the SillyTavern port)
- `packages/providers`: all 26 SillyTavern chat-completion sources ported as framework-free TypeScript — request building, message conversion, stream normalization, model-list fetching (chat-completions family only; no legacy text-completion backends)
- Secret store ported from SillyTavern: multiple named keys per provider, rotation, masked display
- Notebook CRUD (create, rename, delete, list)
- Add a source by pasting text; stored as a frontmattered Markdown file on disk + SQLite metadata row (see ADR 0006)
- Source list and read-only source viewer in the UI
- Streaming chat (SSE) grounded in user-selected sources, injected into the prompt whole (no retrieval yet)
- Provider/model selection per notebook, overridable per chat; live model lists; connection test
- Assistant messages snapshot their context (sources, provider, model) for the future inspector

**Done when:** a user can create a notebook, paste in a lore document, pick a provider/model (e.g. NanoGPT or OpenRouter) with their own key, ask "summarize this" in chat, and watch a grounded, streamed answer arrive — all data visible on disk, keys managed in the UI.

The initial database schema covers notebooks, sources, chats, and messages. Source provenance was added in schema v2 during M2.

## M2 — Source ingestion pipeline

**Goal:** get real-world source material in, not just pasted text.

**Status (2026-07-15):** in progress. Local file upload and conversion are implemented for Markdown, text, PDF, HTML, and SillyTavern lorebook and character-card JSON, including editable previews, batch save, provenance metadata, deletion, and ordinary editing (title/content) of a saved source. Webpage acquisition by URL and full re-ingestion (replacing origin/provenance) remain.

**Scope:**

- ✅ File upload: `.md`, `.txt`, PDF, and HTML converted to Markdown; SillyTavern lorebook and character-card JSON extracted into focused sources
- ⏳ Webpage acquisition by URL and conversion to Markdown
- ✅ Conversion review step: user sees and can edit the produced Markdown before it is saved
- ⏳ Origin metadata recorded (file name and conversion notes are implemented; URL provenance awaits URL acquisition)
- ✅ Source editing after ingestion (title/content, identity and provenance preserved); delete is implemented
- ⏳ Re-ingestion (replacing an existing source's origin/provenance wholesale)

**Done when:** a user can drop in a PDF setting bible and a pasted wiki page, review the conversions, fix a mangled table, and chat over them.

## M3 — Knowledge-base organization ✅

**Goal:** scale from "a few documents" to "a real project bible."

**Status (2026-07-17):** complete. Categories and tags persist in frontmatter (files stay the source of truth, reconciled on read), full-text search runs on a standalone FTS5 index kept in sync by the source services (ADR 0012), the source browser filters/searches/sorts with ranked excerpts, and the chat source selector supports search plus "Select results". Stub-provider E2E coverage in `apps/e2e/tests/organization.spec.ts`.

**Later enhancement (2026-07-17):** new-source review flows now use the notebook's configured model to suggest an editable canonical category and tags. Suggestions are transient and failure-tolerant; accepted metadata still persists through Markdown frontmatter.

**Later enhancement (2026-07-18):** the source browser's Organize dialog runs the same classification over sources already in the notebook (unorganized ones preselected, up to 100 per pass). Suggestions never replace saved organization silently — a blank category keeps the saved one and suggested tags extend the saved list — and every value stays editable before it is applied through the ordinary source PATCH boundary.

**Scope:**

- Source categories (characters, places, factions, timelines, lore, rules, style, plot, research, misc) and free-form tags
- Full-text search across the notebook (SQLite FTS5)
- Source browser: filter by category/tag, search, sort
- Search-backed context selection in chat (choose sources by search, not just by list)

**Done when:** a 100-source campaign world is navigable — find every mention of a faction in seconds and pull exactly the right sources into a chat.

## M4 — Native Preset Studio and response capture ✅

**Goal:** give users one transparent, reusable way to shape chat completion requests, inspect exactly what produced a response, and bring useful responses back into the source library.

**Scope:**

- A versioned native global preset library with one global default and optional per-chat selection; a chat with no explicit selection inherits the global default
- Preset Studio controls for temperature, top-p, maximum output tokens, optional assistant prefill, and ordered prompt modules
- Custom prompt modules plus one protected Sources module, with deterministic `before_history` and full `at_depth` insertion
- Native JSON import with local review and strict shared-schema validation; no SillyTavern preset compatibility or preset export in M4
- An immutable per-exchange inspector showing the captured preset, canonical message order, exact source content, requested controls, and secret-free provider-effective request body
- Basic **Add to sources** for reviewing an assistant response and saving it as Markdown with chat/message provenance

**Done when:** a user can import or author a reusable preset, make it the global default or select it for a chat, tune controls and module depth/order, verify a generated exchange from its immutable inspector, and review/save the assistant response as a provenance-bearing Markdown source.

**Later additions on this base (2026-07-15):** an optional `thinking` generation control (reasoning shown collapsed in chat), regenerate-as-swipeable-variants on assistant messages, and bulk source selection (Select all/Clear all). See `docs/ARCHITECTURE.md` and `docs/superpowers/plans/2026-07-15-response-controls-plan.md`.

## M5 — Creative outputs & exports

**Goal:** update existing material safely and export project knowledge in the formats creative users need.

**Scope:**

- Update an existing source from a chat response with a reviewable diff; basic response-to-new-source creation moved to M4
- SillyTavern lorebook (World Info) export from selected sources
- Setting-bible export: assemble categorized sources into one organized Markdown document
- Rewrite workflows: ask the model to restructure or rewrite an entry and diff-review the result before updating it

**Done when:** a worldbuilder can review a response-derived update before applying it to an existing source, then export a working SillyTavern lorebook and a shareable setting bible.

## M6 — Creative skills library ✅

**Goal:** reusable craft instructions ("skills") the model can be given per chat — the foundation for a later integrated agent. See ADR 0011.

**Status (2026-07-17):** complete. Skills CRUD (server and UI), per-chat attachment with `## Skills` injection, exchange-snapshot capture shown in the Prompt Inspector, the one-click starter-set install, and stub-provider E2E coverage are all implemented. The starter set was subsequently rewritten to be generative-first (produce source-ready Markdown, not just critique) with provenance recorded in `apps/server/skills-starter/ATTRIBUTION.md`.

**Scope:**

- Skills as agentskills.io-compatible `SKILL.md` folders under `data/skills/`, indexed in SQLite, globally scoped like presets
- Skills library UI: list, create, edit, delete
- Per-chat skill attachment (parallel to source selection); attached skills injected as a `## Skills` system message beside the protected Sources module — no preset schema change, no provider-layer change
- Skill content captured in the immutable exchange snapshot and shown in the Prompt Inspector
- A curated, MIT-attributed starter set adapted from jwynia/agent-skills for generative-first, source-ready output, installable in one click

**Done when:** a user installs the starter set, attaches a skill to a chat, sends a message, and the Prompt Inspector shows the exact skill text the model received — with the skill visible and editable as Markdown on disk.

## Later / unscheduled

Ideas that are real but not yet committed to a milestone: retrieval smarter than FTS (embeddings), a model-driven skill activation loop (progressive disclosure over the M6 library, then orchestrator skills, then native tool calling — ADR 0011 phases 2–3), contradiction detection sweeps, timeline visualization, multi-notebook cross-referencing, alternate-canon branches, collaborative/multi-user mode, desktop packaging (Tauri), SillyTavern legacy text-completion backends if ever needed.
