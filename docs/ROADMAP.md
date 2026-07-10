# Roadmap

Milestones are ordered so that every one ends with a working, demoable app. Each has a goal and explicit "done when" criteria.

## M0 — Repository foundation ✅ (this milestone)

**Goal:** a correctly set up repository: tooling, structure, CI, and design docs — no feature code.

**Done when:**

- pnpm workspace monorepo with `apps/server` (Fastify), `apps/web` (React + Vite), `packages/shared`
- `pnpm lint / typecheck / test / build` all pass locally and in CI
- `pnpm dev` boots both processes; the web shell reaches the server through the Vite proxy
- README, ARCHITECTURE, ROADMAP, and ADRs committed

## M1 — Walking skeleton

**Goal:** the thinnest end-to-end slice of the real product: create a notebook, add a source, chat with it.

**Scope:**

- Notebook CRUD (create, rename, delete, list)
- Add a source by pasting text; stored as a Markdown file on disk + SQLite metadata row
- Source list and read-only source viewer in the UI
- Chat with one provider — an OpenAI-compatible endpoint (configurable base URL + key) — with streaming responses
- Sources injected into the prompt whole (no retrieval); user picks which sources are in context
- SQLite schema v1: notebooks, sources, chats, messages

**Done when:** a user can create a notebook, paste in a lore document, ask "summarize this" in chat, and watch a grounded, streamed answer arrive — all data visible on disk.

## M2 — Source ingestion pipeline

**Goal:** get real-world source material in, not just pasted text.

**Scope:**

- File upload: `.md`, `.txt` direct; PDF and HTML/webpage (by URL) converted to Markdown
- Conversion review step: user sees and can edit the produced Markdown before it is saved
- Origin metadata recorded (file name, URL, conversion notes)
- Source editing after ingestion; delete/re-ingest

**Done when:** a user can drop in a PDF setting bible and a pasted wiki page, review the conversions, fix a mangled table, and chat over them.

## M3 — Model-provider layer

**Goal:** genuine model agnosticism, SillyTavern-style.

**Scope:**

- Provider adapters: Anthropic native, OpenAI native, OpenRouter, Ollama/local, custom OpenAI-compatible
- Provider/key management UI (keys stored locally, masked in the UI)
- Model selection per notebook, overridable per chat; switching models mid-project never loses data
- Basic generation settings (temperature, max tokens) per chat

**Done when:** the same notebook can run a continuity question against one model and a prose draft against another, switching in two clicks.

## M4 — Knowledge-base organization

**Goal:** scale from "a few documents" to "a real project bible."

**Scope:**

- Source categories (characters, places, factions, timelines, lore, rules, style, plot, research, misc) and free-form tags
- Full-text search across the notebook (SQLite FTS5)
- Source browser: filter by category/tag, search, sort
- Search-backed context selection in chat (choose sources by search, not just by list)

**Done when:** a 100-source campaign world is navigable — find every mention of a faction in seconds and pull exactly the right sources into a chat.

## M5 — Creative response controls

**Goal:** the user shapes how creatively the model treats their canon.

**Scope:**

- Canon-strictness spectrum on every chat: strict canon → grounded development → loose inspiration → open invention
- Task presets bundling strictness + prompt strategy: continuity check, lore Q&A, expand entry, prose draft, brainstorm
- Per-notebook defaults; visible indicator of the active mode
- "What was the model given?" inspector: show the exact sources and instructions in any exchange

**Done when:** the same question produces a canon-faithful answer in strict mode and a wild alternative in open mode, and the user can see exactly why.

## M6 — Creative outputs & exports

**Goal:** results leave the app in the formats creative users need.

**Scope:**

- Save chat outputs back into the notebook as new/updated sources
- SillyTavern lorebook (World Info) export from selected sources
- Setting-bible export: assemble categorized sources into one organized Markdown document
- Rewrite workflows: ask the model to restructure/rewrite an entry and diff-review the result before saving

**Done when:** a worldbuilder can develop a setting in worldbookllm and export a working SillyTavern lorebook and a shareable setting bible from it.

## Later / unscheduled

Ideas that are real but not yet committed to a milestone: retrieval smarter than FTS (embeddings), contradiction detection sweeps, timeline visualization, multi-notebook cross-referencing, alternate-canon branches, collaborative/multi-user mode, desktop packaging (Tauri).
