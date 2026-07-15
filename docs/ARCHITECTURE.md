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
- **`apps/e2e`** — Playwright coverage for complete browser journeys, backed by a local stub provider for deterministic generation tests.
- **`packages/providers`** — framework-free provider request building, message conversion, model discovery, and stream normalization.
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

The implemented upload path accepts Markdown, plain text, PDF, HTML, and SillyTavern lorebook or character-card JSON. Conversion produces a transient, editable preview; saving the reviewed preview writes the Markdown file and provenance metadata. Webpage acquisition by URL and editing or re-ingesting an existing source remain in progress for Milestone 2.

## Provider layer (model-agnostic AI)

The provider layer lives in **`packages/providers`** — a framework-free TypeScript package **ported from SillyTavern's** battle-tested backends (see ADR 0005; the project is AGPL-3.0 as a consequence). It supports all 26 of SillyTavern's chat-completion sources: OpenAI, Anthropic Claude, OpenRouter, NanoGPT, Google Gemini/Vertex, Mistral, Cohere, DeepSeek, Groq, xAI, Perplexity, Azure OpenAI, and more — plus a `custom` OpenAI-compatible source covering Ollama, LM Studio, llama.cpp, and self-hosted endpoints via a configurable base URL.

The package is pure: no filesystem, no HTTP framework, no secret reads. It exposes:

- `buildChatRequest(source, params)` → `{url, headers, body}` — per-provider request construction, including message-format conversion (from the ported `prompt-converters`)
- stream utilities — SSE parsing plus per-provider delta normalization, so the browser only ever sees one event format
- model-list building/parsing per provider (live endpoints where they exist, curated static lists otherwise)

The server performs the actual `fetch`, injects keys from the local secret store (multiple named keys per provider with rotation, ported from SillyTavern's SecretManager; stored in `data/secrets.json`, always masked in API responses), and pipes normalized SSE events to the browser.

Model + provider selection is configurable **per notebook**, overridable **per chat**. Keys never leave the server beyond masked display. Switching models never requires rebuilding a project — sources and chats are provider-independent.

## Native preset library and exchange provenance

Creative response controls use one versioned, native preset model rather than separate canon modes or task-specific generation paths. Presets are global records. Exactly one is the global default; a chat either inherits that default or selects another global preset. Notebook settings choose providers and models but do not own preset defaults.

Each preset contains generation controls and an ordered module list. Custom modules carry a role, content, enabled state, and either a `before_history` insertion or a nonnegative `at_depth` value. Every preset also contains exactly one protected Sources module: its insertion and order are configurable, while its role, enabled state, and source-expanded content are not. The server deterministically assembles enabled modules, eligible history, exact selected-source Markdown, and the protected newest user message. The normative portable contract is [PRESET_SCHEMA.md](PRESET_SCHEMA.md).

Generation resolves the chat-to-global inheritance once at request preparation. It stores an immutable exchange context containing the resolved preset definition, canonical messages after module/depth assembly, source IDs, hashes and content, requested controls, and the provider-effective request body after provider conversion. Headers, API keys, request URLs, and other secret material are never included. Later preset or source edits therefore affect future generations but cannot rewrite what a completed or interrupted exchange says the model received.

Assistant responses can be reviewed and saved through the normal source-creation boundary. The result is a visible Markdown file with structured `assistant-response` origin metadata containing the originating `chatId` and `messageId`; SQLite keeps the same provenance as a rebuildable index. Updating existing sources, diff review, and export remain separate later workflows.

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
<<<<<<< HEAD
- [0007 — Fastify multipart for source uploads](decisions/0007-fastify-multipart-source-uploads.md)
- [0008 — PDF and HTML conversion dependencies](decisions/0008-pdf-html-conversion-dependencies.md)
- [0009 — Native global presets and immutable exchange snapshots](decisions/0009-native-global-presets.md)
=======
- [0007 — Parse source uploads with @fastify/multipart](decisions/0007-fastify-multipart-source-uploads.md)
- [0008 — PDF and HTML conversion dependencies](decisions/0008-pdf-html-conversion-dependencies.md)
>>>>>>> origin/main
