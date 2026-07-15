# Roadmap

Milestones are ordered so that every one ends with a working, demoable app. Each has a goal and explicit "done when" criteria.

## M0 — Repository foundation ✅

**Goal:** a correctly set up repository: tooling, structure, CI, and design docs — no feature code.

**Done when:**

- pnpm workspace monorepo with `apps/server` (Fastify), `apps/web` (React + Vite), `packages/shared`
- `pnpm lint / typecheck / test / build` all pass locally and in CI
- `pnpm dev` boots both processes; the web shell reaches the server through the Vite proxy
- README, ARCHITECTURE, ROADMAP, and ADRs committed

## M1 — Walking skeleton + full provider layer ✅

**Goal:** the first usable app — create a notebook, add sources, chat with them — built on genuine model agnosticism from day one, via a provider layer ported from SillyTavern (see ADR 0005).

**Status (2026-07-14):** complete and operator-verified, including the mandatory live NanoGPT E2E and server smoke paths. All nine phases are implemented: the server, notebook/source workspace, provider settings, streaming chat UI, stop/interrupted behavior, and complete walking-skeleton E2E. See `docs/superpowers/specs/2026-07-10-m1-phases-6-9-contracts-design.md` for the phase contracts.

**Scope:**

- Relicense to AGPL-3.0 (prerequisite for the SillyTavern port)
- `packages/providers`: all 26 SillyTavern chat-completion sources ported as framework-free TypeScript — request building, message conversion, stream normalization, model-list fetching (chat-completions family only; no legacy text-completion backends)
- Secret store ported from SillyTavern: multiple named keys per provider, rotation, masked display
- Notebook CRUD (create, rename, delete, list)
- Add a source by pasting text; stored as a frontmattered Markdown file on disk + SQLite metadata row (better-sqlite3, schema v1: notebooks, sources, chats, messages — see ADR 0006)
- Source list and read-only source viewer in the UI
- Streaming chat (SSE) grounded in user-selected sources, injected into the prompt whole (no retrieval yet)
- Provider/model selection per notebook, overridable per chat; live model lists; connection test
- Assistant messages snapshot their context (sources, provider, model) for the future inspector

**Done when:** a user can create a notebook, paste in a lore document, pick a provider/model (e.g. NanoGPT or OpenRouter) with their own key, ask "summarize this" in chat, and watch a grounded, streamed answer arrive — all data visible on disk, keys managed in the UI.

## M2 — Source ingestion pipeline

**Goal:** get real-world source material in, not just pasted text.

**Scope:**

- File upload: `.md`, `.txt` direct; PDF and HTML/webpage (by URL) converted to Markdown; SillyTavern lorebook and character-card JSON extracted into focused sources
- Conversion review step: user sees and can edit the produced Markdown before it is saved
- Origin metadata recorded (file name, URL, conversion notes)
- Source editing after ingestion; delete/re-ingest

**Done when:** a user can drop in a PDF setting bible and a pasted wiki page, review the conversions, fix a mangled table, and chat over them.

## M3 — Knowledge-base organization

**Goal:** scale from "a few documents" to "a real project bible."

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

## M5 — Creative outputs & exports

**Goal:** update existing material safely and export project knowledge in the formats creative users need.

**Scope:**

- Update an existing source from a chat response with a reviewable diff; basic response-to-new-source creation moved to M4
- SillyTavern lorebook (World Info) export from selected sources
- Setting-bible export: assemble categorized sources into one organized Markdown document
- Rewrite workflows: ask the model to restructure or rewrite an entry and diff-review the result before updating it

**Done when:** a worldbuilder can review a response-derived update before applying it to an existing source, then export a working SillyTavern lorebook and a shareable setting bible.

## Later / unscheduled

Ideas that are real but not yet committed to a milestone: retrieval smarter than FTS (embeddings), contradiction detection sweeps, timeline visualization, multi-notebook cross-referencing, alternate-canon branches, collaborative/multi-user mode, desktop packaging (Tauri), SillyTavern legacy text-completion backends if ever needed.
