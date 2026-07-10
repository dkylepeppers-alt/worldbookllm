# Architecture

worldbookllm is a **local-first web app**: a Node/TypeScript server and a browser UI that run together on the user's machine (the same self-hosting shape as SillyTavern). The user's sources, chat history, and API keys never leave their computer unless they call an AI provider.

## System overview

```
┌─────────────────────────┐        ┌──────────────────────────────────┐
│  apps/web               │        │  apps/server                     │
│  React + Vite SPA       │  HTTP  │  Fastify (Node/TS)               │
│                         │◄──────►│                                  │
│  notebook browser       │  + SSE │  REST API        provider layer ─┼──► AI APIs
│  source viewer/editor   │        │  ingestion       (user's keys)   │
│  chat UI                │        │  pipeline                        │
└─────────────────────────┘        └────────┬─────────────────────────┘
                                            │
                                   ┌────────▼─────────┐
                                   │  data/           │
                                   │  *.md  + SQLite  │
                                   └──────────────────┘
```

- **`apps/web`** — a static React SPA built with Vite. In development, Vite proxies `/api` to the server; in production the server serves the built bundle. All state changes go through the API.
- **`apps/server`** — a Fastify server that owns everything stateful: the data directory, the SQLite database, source ingestion, and calls to AI providers. Chat responses stream to the client (SSE).
- **`packages/shared`** — TypeScript types and zod schemas shared by both sides, so API payloads are validated at the boundary and typed end to end.

## Data model: Markdown on disk + SQLite index

The guiding principle from the product spec: **sources remain visible and manageable by the user**, never hidden inside an opaque context system.

- **Sources are plain `.md` files on disk.** Users can read, grep, edit, back up, and version them with any tool. Editing a file outside the app is legal; the app reconciles on next access.
- **SQLite holds everything that is _about_ the files**, plus app state: source metadata (origin, conversion notes, category, tags), the full-text search index (FTS5), chat sessions and messages, notebook settings, and provider/model configuration.

Planned data directory layout (created at first run, gitignored):

```
data/
├── worldbookllm.db            # SQLite: metadata, search index, chats, settings
└── notebooks/
    └── <notebook-id>/
        └── sources/
            └── <source-id>-<slug>.md
```

Each source file carries YAML frontmatter (id, title, category, origin) so the files are self-describing even without the database; the database can be rebuilt from the files if it is lost.

## Source ingestion pipeline

Every source, whatever its origin (pasted text, uploaded file, PDF, webpage, transcript), flows through the same pipeline:

```
acquire → extract text → convert to Markdown → user review/edit → store (file + DB row + FTS index)
```

Conversion is best-effort and **transparent**: the user sees what was produced, can edit it, and the original origin is recorded in metadata. Nothing enters the knowledge base without being inspectable Markdown.

## Provider layer (model-agnostic AI)

The provider layer lives in **`packages/providers`** — a framework-free TypeScript package **ported from SillyTavern's** battle-tested backends (see ADR 0005; the project is AGPL-3.0 as a consequence). It supports all 26 of SillyTavern's chat-completion sources: OpenAI, Anthropic Claude, OpenRouter, NanoGPT, Google Gemini/Vertex, Mistral, Cohere, DeepSeek, Groq, xAI, Perplexity, Azure OpenAI, and more — plus a `custom` OpenAI-compatible source covering Ollama, LM Studio, llama.cpp, and self-hosted endpoints via a configurable base URL.

The package is pure: no filesystem, no HTTP framework, no secret reads. It exposes:

- `buildChatRequest(source, params)` → `{url, headers, body}` — per-provider request construction, including message-format conversion (from the ported `prompt-converters`)
- stream utilities — SSE parsing plus per-provider delta normalization, so the browser only ever sees one event format
- model-list building/parsing per provider (live endpoints where they exist, curated static lists otherwise)

The server performs the actual `fetch`, injects keys from the local secret store (multiple named keys per provider with rotation, ported from SillyTavern's SecretManager; stored in `data/secrets.json`, always masked in API responses), and pipes normalized SSE events to the browser.

Model + provider selection is configurable **per notebook**, overridable **per chat**. Keys never leave the server beyond masked display. Switching models never requires rebuilding a project — sources and chats are provider-independent.

## Creative response controls

Chat requests carry a **canon-strictness setting** that shapes how sources are used in the prompt, on a spectrum:

1. **Strict canon** — sources are authoritative; the model must not contradict them (continuity checks, lore Q&A).
2. **Grounded development** — sources anchor the work, gaps may be filled in a consistent way (expanding lore, drafting entries).
3. **Loose inspiration** — sources set tone and direction, invention is welcome (brainstorming, alternates).
4. **Open invention** — sources are background flavor; the model creates freely (new material, what-ifs).

These map to prompt-assembly strategies, not different codepaths — one chat pipeline, parameterized.

## Context strategy

Milestone 1 injects selected sources into the prompt whole (simple, predictable, sufficient for small notebooks). Retrieval (FTS5-backed selection, then smarter ranking) arrives when notebooks outgrow context windows — see the [roadmap](ROADMAP.md). The design constraint throughout: the user can always see and control what the model was given.

## Technology choices

Recorded as ADRs in [`docs/decisions/`](decisions/):

- [0001 — Local-first web app](decisions/0001-local-first-web-app.md)
- [0002 — React + Vite frontend, Fastify backend](decisions/0002-react-vite-fastify.md)
- [0003 — Markdown files + SQLite index](decisions/0003-markdown-files-sqlite-index.md)
- [0004 — pnpm workspace monorepo](decisions/0004-pnpm-monorepo.md)
- [0005 — SillyTavern provider port; AGPL-3.0 relicense](decisions/0005-sillytavern-provider-port-agpl.md)
- [0006 — better-sqlite3 for the index database](decisions/0006-better-sqlite3.md)
