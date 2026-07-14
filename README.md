# worldbookllm

A model-agnostic creative writing and worldbuilding workspace that ingests your sources, converts them into organized Markdown, and lets you chat with your project knowledge base — with flexible controls for source reliance, tone, originality, and creative expansion.

## What it is

worldbookllm is a **local-first**, source-grounded creative development environment for writers, worldbuilders, game masters, roleplay designers, and fiction developers. Think NotebookLM, but built for creative work instead of research — and with your choice of AI model instead of a fixed one.

- **Part source manager** — upload, paste, or import your material; the app converts it into clean, inspectable Markdown that stays visible and editable, never hidden inside an opaque AI context.
- **Part Markdown knowledge base** — organize characters, places, factions, timelines, lore, rules, plot material, and rough fragments into per-project notebooks.
- **Part AI chat interface** — ask questions of your canon, find contradictions, expand ideas, draft prose, and generate new worldbuilding, grounded in _your_ sources.
- **Part creative collaborator** — you decide whether sources act as strict canon, loose inspiration, background reference, or fuel for open invention. You also decide which AI model and provider to use, per notebook or per chat.

Your data stays on your machine: sources are plain Markdown files on disk, metadata lives in a local SQLite database, and API keys never leave your computer.

## Status

**Milestone 1 — walking skeleton (complete).** Create a notebook, paste a source, pick a provider, and watch a grounded answer stream into the chat — the whole journey, including stop/interrupt and reload persistence, runs end-to-end in CI against a stub provider and has been operator-verified against NanoGPT. Milestone 2 source ingestion is in progress; see the [roadmap](docs/ROADMAP.md) for current scope.

## Quick start

Requires Node.js ≥ 20.19 and [pnpm](https://pnpm.io) 9.

```bash
pnpm install
pnpm dev        # starts the API server (:3001) and the web UI (:5173)
```

Other commands:

```bash
pnpm build      # build all packages
pnpm test       # run all tests
pnpm lint       # lint
pnpm typecheck  # typecheck all packages
pnpm format     # format with prettier
```

## Repository layout

```
apps/server/      Fastify API server — owns files, SQLite, and AI provider calls
apps/web/         React + Vite web UI
apps/e2e/         Playwright end-to-end tests and stub provider
packages/providers/  Framework-free multi-provider request and streaming layer
packages/shared/  Types and schemas shared between server and web
docs/             Architecture, roadmap, and decision records
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — system design and data model
- [Roadmap](docs/ROADMAP.md) — milestones and "done when" criteria
- [Decision records](docs/decisions/) — why the stack looks the way it does

## License & attribution

worldbookllm is licensed under the [GNU AGPL-3.0](LICENSE).

The multi-provider AI layer (`packages/providers`) is ported from
[SillyTavern](https://github.com/SillyTavern/SillyTavern) (AGPL-3.0) — the
per-provider request building, message conversion, and streaming logic there is
derived from SillyTavern's battle-tested backends. Ported files carry
attribution headers referencing the SillyTavern commit they derive from.
