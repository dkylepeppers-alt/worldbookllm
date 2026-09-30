# worldbookllm

worldbookllm is a workspace for **writing books and building their worlds** with an AI model of your choice. Each book is a [story-skills](https://github.com/danjdewhurst/story-skills) project: characters, places, chapters, scenes, continuity notes, and research as plain Markdown files. An agent works inside the book with you — it reads the files, loads craft skills, runs the `story` checks, and writes changes you can review and undo.

It runs entirely on your own machine (or phone — see [Termux](#install-on-android-termux) below). Your writing, chat history, and API keys stay local; the only outbound traffic is the model call itself, to whichever provider you choose.

## The loop

1. **Bring material in.** Paste text, or upload `.md`, `.txt`, PDF, HTML, or SillyTavern lorebook/character-card JSON. Everything is converted to Markdown you review _before_ it's filed into the book — as research notes by default, or as characters and other entities when the material already fits. A manuscript can become a new book.
2. **Build the book.** Add characters, locations, chapters, and scenes; the `story` CLI keeps registries and cross-references correct, and the Health tab runs its continuity, timeline, and pacing checks.
3. **Work with the agent.** Ask for a location, a revision, or a continuity pass. The agent loads the story-skills craft skills it needs, reads and searches the book, runs `story` commands, and writes files. Every turn ends with a change summary and per-file diffs you can undo, or, in review mode, proposed changes you apply or skip file by file. A step inspector shows exactly what the model received.
4. **Shape the agent.** Save custom agents — a continuity checker, a line editor — with their own instructions and skills, and tune the generation settings (temperature, top-p, a token cap, thinking) in Settings.

Because books are plain `.md` files on disk (SQLite is just a rebuildable index — [ADR 0003](docs/decisions/0003-markdown-files-sqlite-index.md)), you can also edit, grep, sync, and version them with any tool you already use.

## Choose your model

The provider layer is ported from SillyTavern's battle-tested backends and supports **26 chat-completion providers** — OpenAI, Anthropic Claude, OpenRouter, NanoGPT, Google Gemini/Vertex, Mistral, Cohere, DeepSeek, Groq, xAI, Perplexity, Azure OpenAI, and more — plus any OpenAI-compatible endpoint (Ollama, LM Studio, llama.cpp, self-hosted). Keys are stored locally in `data/secrets.json`, never displayed unmasked, and never sent anywhere except the provider you picked. Provider and model are one global setting; switching models never requires rebuilding a book.

## What works today

- Books as story-skills projects: a phone-first workspace (Write / Bible / Agent / Health / Project) with a Markdown editor, `story` checks, rename/remove, and history with undo
- Ingestion into books (`.md`, `.txt`, PDF, HTML, SillyTavern lorebook/character-card JSON) with editable conversion previews; manuscripts via `story import`
- The book agent: streaming tool-calling turns, change summaries with diffs and undo, review mode, a step inspector, stop
- Skills library (the pinned story-skills set plus your own) and saved custom agents
- Installable PWA, served single-origin by the server in production

Upgrading from the notebook era? Notebooks, with their sources and chats, move into books automatically the first time the server starts ([ADR 0017](docs/decisions/0017-retire-notebooks-and-presets.md)); the original files are kept in `data/notebooks.migrated/`.

Not there yet (see the [roadmap](docs/ROADMAP.md)): series and a series bible, `story build` exports (EPUB, DOCX, …) from the UI, and SillyTavern lorebook/character-card export.

## Requirements

- **Node.js ≥ 20.19** and **pnpm 9** (`corepack enable` activates the pinned version automatically)
- Roughly 1 GB of disk for dependencies and build output
- An API key for at least one supported provider, or a local OpenAI-compatible server such as Ollama

## Install and run

```bash
git clone https://github.com/dkylepeppers-alt/worldbookllm.git
cd worldbookllm
corepack enable          # or: npm install -g pnpm@9
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

worldbookllm runs well as a pocket worldbuilding notebook under [Termux](https://termux.dev) (install it from F-Droid or the Play Store — the F-Droid build is the commonly recommended one). The one platform quirk: `better-sqlite3` has no prebuilt binary for Android, so it compiles from source during `pnpm install` — that's what the compiler packages below are for, and why the install takes a few extra minutes.

```bash
# 1. Base packages and build tools
pkg update && pkg upgrade
pkg install nodejs-lts git python clang make binutils

# 2. pnpm
corepack enable          # or: npm install -g pnpm@9

# 3. Clone and install (better-sqlite3 compiles here — be patient)
git clone https://github.com/dkylepeppers-alt/worldbookllm.git
cd worldbookllm
pnpm install

# 4. Build and run
pnpm build
pnpm start
```

Then open **http://localhost:3001** in your Android browser. Because `localhost` counts as a secure origin, you can install it as a PWA straight from the browser menu ("Add to Home Screen" / "Install app") — no HTTPS setup needed.

Termux-specific tips:

- **Keep it running:** acquire a wake lock with `termux-wake-lock` (or the persistent Termux notification's "Acquire wakelock" button) before long sessions, and exclude Termux from battery optimization in Android settings, or Android will kill the server in the background.
- **Keep `data/` in Termux home.** Don't set `DATA_DIR` to shared storage (`/sdcard`, `~/storage/shared`) — Android shared storage doesn't support the file locking SQLite needs. To back up, archive the data directory and _copy_ the archive out: `tar czf ~/storage/shared/worldbook-backup.tar.gz -C ~/worldbookllm data` (run `termux-setup-storage` once first).
- **If the build runs out of memory** on a low-RAM device, retry with `NODE_OPTIONS=--max-old-space-size=2048 pnpm build`, closing other apps first.
- **Sharp warnings are harmless.** The `sharp` image library has no Android build; it's only used by a manual icon-regeneration script, and the icons are already committed. Install and build don't need it.
- **Local models:** a phone won't run a serious model, but Termux + a provider key works fine — or point the `custom` provider at an Ollama/llama.cpp server on another machine on your network.

## Updating

```bash
git pull
pnpm install
pnpm build
```

Then restart (`pnpm start`, or however you run it). Database migrations run automatically on startup; your books are never touched by upgrades. (The one-time move from notebooks into books, ADR 0017, writes new books and renames the old folder rather than deleting anything.)

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
- [Decision records](docs/decisions/) — why the stack looks the way it does

## License & attribution

worldbookllm is licensed under the [GNU AGPL-3.0](LICENSE).

The multi-provider AI layer (`packages/providers`) is ported from
[SillyTavern](https://github.com/SillyTavern/SillyTavern) (AGPL-3.0); ported files
carry attribution headers referencing the SillyTavern commit they derive from.
The starter skills are adapted from [jwynia/agent-skills](https://github.com/jwynia/agent-skills)
(MIT) — see `apps/server/skills-starter/ATTRIBUTION.md`.
