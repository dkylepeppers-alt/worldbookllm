# Architecture

worldbookllm is a **local-first web app**: a Node/TypeScript server and a browser UI that run together on the user's machine (the same self-hosting shape as SillyTavern). The user's books, chat history, and API keys never leave their computer unless they call an AI provider.

## System overview

```
┌─────────────────────────┐        ┌──────────────────────────────────┐
│  apps/web               │        │  apps/server                     │
│  React + Vite SPA       │  HTTP  │  Fastify (Node/TS)               │
│                         │◄──────►│                                  │
│  book library + editor  │  + SSE │  REST API        provider layer ─┼──► AI APIs
│  Agent tab              │        │  story CLI,      (user's keys)   │
│  skills, agents         │        │  agent loop                      │
└─────────────────────────┘        └────────┬─────────────────────────┘
                                            │
                                   ┌────────▼─────────┐
                                   │  data/           │
                                   │  *.md  + SQLite  │
                                   └──────────────────┘
```

- **`apps/web`** — a static React SPA built with Vite. In development, Vite proxies `/api` to the server; in production the server serves the built bundle. All state changes go through the API.
- **`apps/server`** — a Fastify server that owns everything stateful: the data directory, the SQLite database, the `story` CLI, ingestion, and calls to AI providers. Agent turns stream to the client (SSE).
- **`apps/e2e`** — Playwright coverage for complete browser journeys, backed by a local stub provider for deterministic generation tests.
- **`packages/providers`** — framework-free provider request building, message conversion, model discovery, and stream normalization.
- **`packages/shared`** — TypeScript types and zod schemas shared by both sides, so API payloads are validated at the boundary and typed end to end.

## Data model: Markdown on disk + SQLite index

The guiding principle from the product spec: **the writer's material remains visible and manageable by the writer**, never hidden inside an opaque context system.

- **Books are plain `.md` files on disk** (ADR 0014). Users can read, grep, edit, back up, and version them with any tool. Editing a file outside the app is legal; the app reconciles on next access.
- **SQLite holds everything that is _about_ the files**, plus app state: the book index (with an FTS5 table following ADR 0012's standalone pattern), checkpoints, agent chats and messages, review-mode changesets, custom agents, the skills index, and one global settings row (provider/model configuration — ADR 0013; review-mode default — ADR 0016; agent generation settings — ADR 0017). The notebook-era tables remain, unused, after the one-time migration (ADR 0017).

Data directory layout (created at first run, gitignored):

```
data/
├── worldbookllm.db            # SQLite: index, chats, checkpoints, settings
├── secrets.json               # named provider API keys (local only)
├── projects/
│   └── <book-slug>/          # a story-skills book (ADR 0014): story.md, characters/, chapters/, …
├── trash/                     # books moved out of the library
├── staging/                   # review-mode copies, removed when each turn ends (ADR 0016)
├── notebooks.migrated/        # notebook sources kept after the move into books (ADR 0017);
│                              #   notebooks.migrated-<timestamp>/ if that name was taken
└── skills/
    └── <name>/
        └── SKILL.md           # agentskills.io-compatible craft instructions
```

## Ingestion

Everything brought into a book flows through one pipeline:

```
acquire → extract text → convert to Markdown → user review/edit → write into the book (one checkpoint)
```

Conversion is best-effort and **transparent**: the user sees what was produced, can edit it, and the origin is recorded as flat frontmatter keys (`origin-type`, `origin-file`/`origin-url`, `imported-at`, `conversion-notes`). The converters accept paste, Markdown, plain text, PDF, HTML, and SillyTavern lorebook or character-card JSON. A book-scoped preview suggests the entity kind each entry should become: an entry whose frontmatter already satisfies a story-skills kind keeps its frontmatter as that entity, a SillyTavern character card suggests `character`, and anything else suggests `research`. Saving writes every reviewed entry as one checkpoint, then reindexes and validates; if validation rejects an imported file, the whole import is undone. A manuscript (`.md`/`.txt`) becomes a new book through `story import`, and a zipped story-skills project (`.zip`) is unpacked whole into a new standalone book, reindexed, and validated (ADR 0020).

## Provider layer (model-agnostic AI)

The provider layer lives in **`packages/providers`** — a framework-free TypeScript package **ported from SillyTavern's** battle-tested backends (see ADR 0005; the project is AGPL-3.0 as a consequence). It supports all 26 of SillyTavern's chat-completion sources: OpenAI, Anthropic Claude, OpenRouter, NanoGPT, Google Gemini/Vertex, Mistral, Cohere, DeepSeek, Groq, xAI, Perplexity, Azure OpenAI, and more — plus a `custom` OpenAI-compatible source covering Ollama, LM Studio, llama.cpp, and self-hosted endpoints via a configurable base URL.

The package is pure: no filesystem, no HTTP framework, no secret reads. It exposes:

- `buildChatRequest(source, params)` → `{url, headers, body}` — per-provider request construction, including message-format conversion (from the ported `prompt-converters`)
- stream utilities — SSE parsing plus per-provider delta normalization, so the browser only ever sees one event format
- model-list building/parsing per provider (live endpoints where they exist, curated static lists otherwise)

The server performs the actual `fetch`, injects keys from the local secret store (multiple named keys per provider with rotation, ported from SillyTavern's SecretManager; stored in `data/secrets.json`, always masked in API responses), and pipes normalized SSE events to the browser.

Function tool calling is ported from the same SillyTavern commit (ADR 0015): `GenerationParams.tools`/`toolChoice` are shaped per provider (OpenAI-style passthrough, Claude `input_schema` with the tools beta, Gemini `function_declarations`), `supportsTools(source)` mirrors upstream's source list, and `ToolCallAccumulator` turns each provider's streamed tool-call fragments into complete calls.

Model + provider selection is a single **global setting** (ADR 0013), configured once on the Settings page and resolved identically for every book and chat. Keys never leave the server beyond masked display. Switching models never requires rebuilding a book — books and chats are provider-independent. The agent's generation controls (temperature, top-p, a per-step token cap, thinking) are a second global setting on the same row (ADR 0017); there are no presets or prompt modules.

## Creative skills library

Skills are reusable craft instructions in the agentskills.io format: a directory per skill at `data/skills/<name>/` whose `SKILL.md` carries `name`/`description` frontmatter and a Markdown instruction body. The files are the source of truth and SQLite is a rebuildable index; skills are global, shared by every book. The agent sees the skill catalog (names and descriptions) and activates a skill on demand (ADR 0015); a custom agent can be limited to a subset (ADR 0016). The pinned story-skills skills are the bundled set, installed from the Skills page or the Agent tab, and writers can write their own. See ADR 0011 for the library format.

## Story-skills books and the agent (M7)

M7 replaces notebooks with [story-skills](https://github.com/danjdewhurst/story-skills) books (ADR 0014) and runs the story-skills skills through a tool-calling agent (ADR 0015). The notebook era is retired (ADR 0017): notebooks move into books at startup, and `/books` is the home route.

- **Books** are story-skills schema v2 projects under `data/projects/<slug>/`, indexed by `(book, path)` with FTS5 search. `apps/server/src/story/` holds the only code that runs the pinned `story` CLI (`StoryCli`: execFile, vendored command allowlist checked against upstream by a test, server-owned `--path`/`--out`/`--dir`/`--json`, timeout, output cap, scrubbed env, the book root shown as `.`), path confinement (`confine`), the index, and checkpoints.
- **Builds** (ADR 0020) run `story build` from the Project tab into the book's `dist/`, which is never indexed or checkpointed. The files are listed, downloaded as sandboxed attachments, and deleted through `/api/books/:book/builds`.
- **Checkpoints** record the before and after bytes of every file a change touches, including CLI-made changes, and undo last-in-first-out, refusing over later edits. A `CheckpointSession` gathers several separately locked writes, such as one agent turn, into a single checkpoint.
- **The web UI** at `/books` (the home route) is a phone-first workspace (Write / Reader / Bible / Agent / Health / Project tabs as a bottom bar, a side rail from 800px) with a raw Markdown editor, `story report`/`next` health, and history with undo. The Reader tab shows the manuscript as `story export` assembles it (chapter prose and matter pages, no frontmatter, outlines, or notes); `GET /api/books/:book/manuscript` exports it to a temporary folder, never into the book or `dist/`, and series bibles have no Reader tab.
- **The Agent tab** (`apps/web/src/agent/`) lists a book's agent chats and streams turns over SSE. The running turn lives in `AgentRunnerProvider` above the tab screens, so it keeps streaming, and can be stopped, while the writer uses other tabs; leaving the book does not stop it. Tool calls show as collapsed chips per step, each turn ends with a change summary built from its checkpoint (per-file line diffs, Undo turn for the newest live checkpoint), and the step inspector shows every recorded request body and tool result. A collapsible **Story commands** panel above the message box runs the read-only `story` checks (the book checks API, not an agent turn) and can add a summary of the result to the message draft. Stopping aborts the request; the server records the message as interrupted and commits the checkpoint, and the client re-reads the chat once it settles. Messages left `streaming` by a server restart are marked interrupted at startup.
- **The agent** (`apps/server/src/agent/`) runs a bounded loop (24 steps) on agent chats bound to a book: it streams text, collects tool calls, runs them (`activate_skill`, `read_skill_file`, `list_files`, `read_file`, `search`, `write_file`, `edit_file`, allowlisted `run_story`, `ask_user`), and feeds results back. An `ask_user` call (ADR 0022) ends the turn; the chat renders its questions as choices with an Other answer, and the writer's pick is sent as the next message. Each step's secret-free request and every tool result are stored on the assistant message; the turn's file changes form one undoable checkpoint. The system prompt carries the installed skill catalog; `StorySkillsInstaller` installs the pinned story-skills skills with their `references/`. Tools act through an `AgentWorkspace`: the live book inside the turn's checkpoint session, or in review mode a staged copy.
- **Review mode** (ADR 0016, global setting with a per-chat override) runs a turn on a staged copy of the book under `data/staging/` (`StagedBook` in `src/story/staging.ts`), so the agent sees its own work and story commands show real effects. At the end of the turn the changed Markdown files (registries excluded) become a changeset. The writer applies or skips each file from the chat's Proposed changes card: applying writes the chosen files as one agent checkpoint, reindexes, and refuses over files changed since the proposal. How the writer decided is attached as a note to the next user message.
- **The notebook migration** (ADR 0017) runs as the server becomes ready: each notebook not yet moved becomes a book, its sources research notes with their provenance, and its chats agent chats that keep each exchange's recorded request body. The move is resumable and retried at each start until it finishes, always in the same book. Once all have moved, `data/notebooks/` is renamed to `data/notebooks.migrated/` (with a timestamp suffix if that name is taken). The library shows the report, including that folder's name, until the writer dismisses it.
- **Custom agents** (ADR 0016) are saved at `/agents`: a name, instructions added to the system prompt under `## Your role`, and an optional skill subset that the skill catalog and `activate_skill` respect. A chat picks one when it starts, or the default agent.

## Series and shared canon

Series live under `data/series/<id>/`: books are sibling projects and `series-bible/` holds shared canon (ADR 0018). Every project keeps its globally unique slug; the bible uses the series id. `BookFileStore` resolves each slug to its current folder, so converting or detaching a book preserves its indexed files, chats, and history. The library reports duplicate on-disk slugs rather than opening a later copy.

`SeriesService` reads membership from those folders and compares entity copies by kind and id. `series-fields.ts` pins the identity/book-local boundary to story-skills 0.18.0; unknown frontmatter and unnamed sections remain local. The Series overview combines identity drift with `story series` and each project's `story links` result.

Push and pull copy only identity fields. Carry creates a missing copy with fresh local defaults; seed adds missing bible entries from a book without replacing existing canon. A sync acquires the normal book locks in slug order, snapshots every changed book, runs `reindex` and `validate`, then records one checkpoint per changed book with a shared label. A failure restores every touched book, including its registries, and records no sync checkpoints. Undo remains per book, from Project history.

A series chat may pass a same-series slug to `read_file`, `list_files`, or `search`, including the bible. Generic writes stay on the chat's own book. `sync_series` is the only cross-book write tool and is unavailable in review mode. Ordinary edits before a sync finish their checkpoint; later edits use a fresh checkpoint session. The turn summary links to each changed book's history.

## Production serving and installability (PWA)

In production, `apps/server` serves the built `apps/web/dist` directly — one process, one port, as ADR 0002 always intended (see ADR 0010 for why this took a follow-up decision to actually implement, and for the installable-PWA work bundled with it). Client-side routes that aren't real files (e.g. `/books/:slug/write`) fall back to `index.html` so React Router can handle them; `/api/*` paths that don't match a route still return the same JSON 404 shape as always.

The web app is an installable PWA: a manifest and generated icon set (Field Atlas branding) plus a service worker that precaches the static app shell for instant loads. Because this is a local-first tool — a book's real state lives in the user's own SQLite database and files, not a cloud backend — the service worker deliberately caches only the shell, never `/api/*`; there is no offline data-mutation queue. See ADR 0010 for the full reasoning.

## Context strategy

The agent reads what it needs through tools rather than receiving whole files up front: it lists and searches the book, reads files, and asks `story` for spoiler-free drafting context. Every request body and tool result is recorded on the message and shown by the step inspector, so the writer can always see what the model was given.

## Technology choices

Recorded as ADRs in [`docs/decisions/`](decisions/):

- [0001 — Local-first web app](decisions/0001-local-first-web-app.md)
- [0002 — React + Vite frontend, Fastify backend](decisions/0002-react-vite-fastify.md)
- [0003 — Markdown files + SQLite index](decisions/0003-markdown-files-sqlite-index.md)
- [0004 — pnpm workspace monorepo](decisions/0004-pnpm-monorepo.md)
- [0005 — SillyTavern provider port; AGPL-3.0 relicense](decisions/0005-sillytavern-provider-port-agpl.md)
- [0006 — better-sqlite3 for the index database](decisions/0006-better-sqlite3.md)
- [0007 — Parse source uploads with @fastify/multipart](decisions/0007-fastify-multipart-source-uploads.md)
- [0008 — PDF and HTML conversion dependencies](decisions/0008-pdf-html-conversion-dependencies.md)
- [0009 — Native global presets and immutable exchange snapshots](decisions/0009-native-global-presets.md) (superseded by 0017)
- [0010 — Installable PWA, served single-origin in production](decisions/0010-pwa-single-origin-serving.md)
- [0011 — Prompt-orchestrated creative skills library](decisions/0011-prompt-orchestrated-skills-library.md)
- [0012 — FTS5 standalone search index synchronized by services](decisions/0012-fts5-standalone-search-index.md)
- [0013 — Single global provider/model setting](decisions/0013-global-provider-settings.md)
- [0014 — Story-skills projects replace notebooks](decisions/0014-story-projects-replace-notebooks.md)
- [0015 — Tool-calling agent loop running story-skills](decisions/0015-tool-calling-agent-loop.md)
- [0016 — Review mode staging and saved custom agents](decisions/0016-review-mode-staging-and-custom-agents.md)
- [0017 — Retire notebooks and presets](decisions/0017-retire-notebooks-and-presets.md)
- [0018 — Series books and the series bible](decisions/0018-series-books-and-the-series-bible.md)
