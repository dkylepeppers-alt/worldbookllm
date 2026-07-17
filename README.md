# worldbookllm

worldbookllm is a tool for **generating new lore**. You feed it your existing material — setting notes, character sheets, campaign logs, half-finished wiki pages — and then work with an AI model of your choice to produce _new_ source documents: factions, settlements, belief systems, character histories, timelines, story ideas. Everything the model generates can be reviewed, edited, and saved back into your project as a plain Markdown file, where it becomes canon the next generation is grounded in.

It runs entirely on your own machine (or phone — see [Termux](#install-on-android-termux) below). Your writing, chat history, and API keys stay local; the only outbound traffic is the model call itself, to whichever provider you choose.

## The loop

Worldbuilding in worldbookllm is a cycle, not a chat log:

1. **Bring canon in.** Paste text, or upload `.md`, `.txt`, PDF, HTML, or SillyTavern lorebook/character-card JSON. Everything is converted to Markdown you review and can fix _before_ it's saved — nothing enters your notebook as an opaque blob.
2. **Select what grounds the generation.** Each chat message is sent with the exact sources you've selected, injected whole. The Prompt Inspector shows you, per exchange, precisely what the model received.
3. **Generate with craft, not just vibes.** Attach **skills** — reusable craft instructions like _settlement design_, _belief systems_, _character naming_, or _story idea generation_ — and tune a **preset** (temperature, prompt modules, prefill, an optional thinking mode). A starter set of sixteen generative-first skills installs in one click.
4. **Save what's good.** Any assistant response can be reviewed and saved as a new Markdown source, with provenance recording which chat and message it came from. Your setting bible grows out of your own generations.

Because sources are plain `.md` files on disk (SQLite is just a rebuildable index — [ADR 0003](docs/decisions/0003-markdown-files-sqlite-index.md)), you can also edit, grep, sync, and version your world with any tool you already use.

## Choose your model

The provider layer is ported from SillyTavern's battle-tested backends and supports **26 chat-completion providers** — OpenAI, Anthropic Claude, OpenRouter, NanoGPT, Google Gemini/Vertex, Mistral, Cohere, DeepSeek, Groq, xAI, Perplexity, Azure OpenAI, and more — plus any OpenAI-compatible endpoint (Ollama, LM Studio, llama.cpp, self-hosted). Keys are stored locally in `data/secrets.json`, never displayed unmasked, and never sent anywhere except the provider you picked. Provider and model are set per notebook and can be overridden per chat; switching models never requires rebuilding a project.

## What works today

- Notebooks with paste and file-upload ingestion (`.md`, `.txt`, PDF, HTML, SillyTavern lorebook/character-card JSON), editable conversion previews, and post-save editing
- Streaming chat (SSE) grounded in per-chat source selection, with stop/interrupt and regenerate-as-variants (swipe between takes on the same message)
- Preset Studio: versioned presets with generation controls, ordered prompt modules, depth insertion, JSON import, one global default — see the [preset schema](docs/PRESET_SCHEMA.md)
- Skills library with the generative starter set, attached per chat like sources
- Per-exchange Prompt Inspector: the immutable record of what the model was actually sent
- Save-response-as-source with chat/message provenance
- Installable PWA, served single-origin by the server in production

Not there yet (see the [roadmap](docs/ROADMAP.md)): fetching webpages by URL, categories/tags/full-text search across large notebooks, diff-reviewed updates to existing sources, and lorebook/setting-bible export.

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

Open http://127.0.0.1:3001, add a provider key under Settings, create a notebook, and add your first source. Your data lives under `./data` (change with `DATA_DIR=...`), and that directory is the only thing you need to back up.

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

Then restart (`pnpm start`, or however you run it). Database migrations run automatically on startup; your Markdown sources are never touched by upgrades.

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
- [Preset JSON schema](docs/PRESET_SCHEMA.md) — the portable preset format, limits, insertion semantics, and examples
- [Decision records](docs/decisions/) — why the stack looks the way it does

## License & attribution

worldbookllm is licensed under the [GNU AGPL-3.0](LICENSE).

The multi-provider AI layer (`packages/providers`) is ported from
[SillyTavern](https://github.com/SillyTavern/SillyTavern) (AGPL-3.0); ported files
carry attribution headers referencing the SillyTavern commit they derive from.
The starter skills are adapted from [jwynia/agent-skills](https://github.com/jwynia/agent-skills)
(MIT) — see `apps/server/skills-starter/ATTRIBUTION.md`.
