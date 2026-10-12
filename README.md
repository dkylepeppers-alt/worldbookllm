# worldbookllm

worldbookllm is a workspace for **writing books and building their worlds** with an AI model of your choice. Each book is a [story-skills](https://github.com/danjdewhurst/story-skills) project: characters, places, chapters, scenes, continuity notes, and research as plain Markdown files. An agent works inside the book with you — it reads the files, loads craft skills, runs the `story` checks, and writes changes you can review and undo.

It runs entirely on your own machine, or on an Android phone under Termux (see [Android](#install-on-android-termux) below). Your writing, chat history, and API keys stay local; the only outbound traffic is the model call itself, to whichever provider you choose.

## The loop

1. **Bring material in.** Paste text, or upload `.md`, `.txt`, PDF, HTML, SillyTavern lorebook/character-card JSON, or a zip of any of these. Everything is converted to Markdown you review _before_ it's filed into the book — as research notes by default, or as characters, chapters, and other entities when the material already fits. A manuscript can become a new book, and a zipped story-skills project becomes a new book too (its Markdown, notes, and cover images; build output and other files are skipped and listed).
2. **Build the book.** Add characters, locations, chapters, and scenes; the `story` CLI keeps registries and cross-references correct, and the Health tab runs its continuity, timeline, and pacing checks. Read the manuscript in the Reader, and build it as EPUB, DOCX, an HTML review copy, a print interior, and other `story build` formats.
3. **Work with the agent.** Ask for a location, a revision, or a continuity pass. The agent loads the story-skills craft skills it needs, reads and searches the book, runs `story` commands, and writes files. Every turn ends with a change summary and per-file diffs you can undo, or, in review mode, proposed changes you apply or skip file by file. A step inspector shows exactly what the model received.
4. **Shape the agent.** Save custom agents — a continuity checker, a line editor — with their own instructions and skills, and tune the generation settings (temperature, top-p, a token cap, thinking) in Settings.

Because books are plain `.md` files on disk (SQLite only indexes them, alongside chats and history — [ADR 0003](docs/decisions/0003-markdown-files-sqlite-index.md)), you can also edit, grep, sync, and version them with any tool you already use.

## Choose your model

The provider layer is ported from SillyTavern's battle-tested backends and supports **26 chat-completion providers** — OpenAI, Anthropic Claude, OpenRouter, NanoGPT, Google Gemini/Vertex, Mistral, Cohere, DeepSeek, Groq, xAI, Perplexity, Azure OpenAI, and more, including a `custom` source for any OpenAI-compatible endpoint (Ollama, LM Studio, llama.cpp, self-hosted). Keys are stored locally in `data/secrets.json`, never displayed unmasked, and never sent anywhere except the provider you picked. Provider and model are one global setting; switching models never requires rebuilding a book.

## What works today

- **Books as story-skills projects** in a phone-first workspace: Write, Reader, Bible, Agent, Health, and Project tabs (plus Branches for interactive books), a Markdown editor, `story` checks, rename/remove, and history with undo
- **Series** with a shared series bible: canon drift and health, push/pull/carry/seed between the bible and each book, and a series-wide style sheet ([ADR 0018](docs/decisions/0018-series-books-and-the-series-bible.md), [ADR 0019](docs/decisions/0019-series-wide-style-sheet.md))
- **Ingestion** of `.md`, `.txt`, PDF, HTML, SillyTavern lorebook/character-card JSON, and zips of them, through one reviewed preview; manuscripts split into chapters; zipped story-skills projects imported as new books, with skipped files reported ([ADR 0026](docs/decisions/0026-one-reviewed-import-pipeline.md))
- **Builds** from the Project tab in `story build`'s single-file formats (EPUB, DOCX, Markdown and Shunn manuscripts, an HTML review copy, a print interior, an audiobook narration script, a retailer metadata sheet, and a Fountain screenplay skeleton), downloaded from the app; the folder-based `codex` format isn't offered ([ADR 0020](docs/decisions/0020-builds-and-project-zip-import.md))
- **The book agent:** streaming tool-calling turns, change summaries with diffs and undo, review mode, questions with clickable choices, a step inspector, stop, and context compaction for long chats
- **Interactive books written in [ink](https://www.inklestudios.com/ink/)** ([ADR 0030](docs/decisions/0030-interactive-books-are-written-in-ink.md)):
  - Make any book interactive, or start an interactive edition of it.
  - Edit chapters in an ink editor that shows compile errors as you type ([ADR 0031](docs/decisions/0031-the-ink-editor-uses-codemirror.md)), or edit each chapter's closing choices in a form.
  - See the story as a branch map, and play it in the app from any knot, with variables preset.
  - Health plays the story down every path it can within a time and state budget, to find dead ends, knots no path reaches, and choices that are never offered; when the budget runs out, it says the result is partial ([ADR 0032](docs/decisions/0032-paths-are-checked-by-playing-the-story.md)).
  - Export it as `.ink` for Inky, as compiled JSON, or as a web page that plays on its own.
  - The agent can check, play, and path-test the ink it writes.
- Skills library (the pinned story-skills set plus your own) and saved custom agents
- Installable PWA, served single-origin by the server in production

Upgrading from the notebook era? Notebooks, with their sources and chats, move into books automatically the first time the server starts ([ADR 0017](docs/decisions/0017-retire-notebooks-and-presets.md)); the original files are kept in `data/notebooks.migrated/` (or `data/notebooks.migrated-<timestamp>/` if that folder already exists), and the library shows which.

Not there yet (see the [roadmap](docs/ROADMAP.md)): SillyTavern lorebook and character-card export, and webpage import by URL.

## Requirements

- **Node.js ≥ 24** (24 is what the project is developed and tested on) and **pnpm 10**. On Node 24, `corepack enable` activates the pinned pnpm; Node 25 and later no longer bundle corepack, so there run `npm install -g pnpm@10` instead.
- Roughly 1 GB of disk for dependencies and build output
- An API key for at least one supported provider, or a local OpenAI-compatible server such as Ollama

## Install and run

```bash
git clone https://github.com/dkylepeppers-alt/worldbookllm.git
cd worldbookllm
corepack enable          # Node 24; on Node 25+: npm install -g pnpm@10
pnpm install
```

**For everyday use** — build once, run one process on one port:

```bash
pnpm build
pnpm start               # http://127.0.0.1:3001
```

Open http://127.0.0.1:3001, add a provider key under Settings, and create your first book. Your data lives under `./data` (change with `DATA_DIR=...`), and that directory is the only thing you need to back up.

**For development** — two processes with hot reload:

```bash
pnpm dev                 # API on :3001, web UI on :5173
```

Docker, reverse-proxy/HTTPS setup (needed to install the PWA from another device), systemd, environment variables, and backup guidance are all covered in [Deployment](docs/DEPLOYMENT.md).

## Install on Android (Termux)

worldbookllm runs well as a pocket writing workspace under [Termux](https://termux.dev) (from F-Droid or its GitHub releases). In short:

```bash
pkg update && pkg upgrade
pkg install nodejs-lts npm git python clang make binutils
npm install -g pnpm@10

git clone https://github.com/dkylepeppers-alt/worldbookllm.git
cd worldbookllm
pnpm install             # better-sqlite3 compiles here; give it a few minutes
pnpm build
pnpm start               # then open http://localhost:3001
```

`localhost` counts as a secure origin, so you can install it from the browser menu as an app with no HTTPS setup.

**[Running on Android](docs/ANDROID.md)** covers the rest:

- why the compiler packages are needed
- keeping the server alive with a wake lock and `tmux`
- updating
- backing up your data
- running it in a Debian guest under proot-distro instead
- fixes for the errors you're most likely to hit

## Updating

```bash
git pull
pnpm install
pnpm build
```

Then restart (`pnpm start`, or however you run it). Database migrations run automatically on startup; your books are never touched by upgrades. (The one-time move from notebooks into books, ADR 0017, writes new books and renames the old folder rather than deleting anything.) Docker and systemd upgrades are in [Deployment](docs/DEPLOYMENT.md#upgrading); Termux and proot in [Running on Android](docs/ANDROID.md).

## Repository layout

```
apps/server/         Fastify API server — owns the data dir, SQLite, and provider calls
apps/web/            React + Vite web UI (installable PWA)
apps/e2e/            Playwright end-to-end tests and a deterministic stub provider
packages/providers/  Framework-free multi-provider request and streaming layer
packages/shared/     Types and zod schemas shared between server and web
docs/                Architecture, roadmap, deployment, and decision records
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — system design and data model
- [Roadmap](docs/ROADMAP.md) — milestones and "done when" criteria
- [Deployment](docs/DEPLOYMENT.md) — production build/run, environment variables, Docker, reverse proxy/HTTPS, backups
- [Running on Android](docs/ANDROID.md) — Termux and proot-distro: install, start, update, back up, troubleshoot
- [Decision records](docs/decisions/) — why the stack looks the way it does

## License & attribution

worldbookllm is licensed under the [GNU AGPL-3.0](LICENSE).

The multi-provider AI layer (`packages/providers`) is ported from
[SillyTavern](https://github.com/SillyTavern/SillyTavern) (AGPL-3.0); ported files
carry attribution headers referencing the SillyTavern commit they derive from.
Books follow [story-skills](https://github.com/danjdewhurst/story-skills) (MIT), whose pinned
`story` CLI and craft skills the app runs and installs. Interactive books are compiled and
played with inkle's [ink](https://github.com/inkle/ink) through [inkjs](https://github.com/y-lohse/inkjs) (MIT).
