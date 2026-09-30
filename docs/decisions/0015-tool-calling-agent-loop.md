# ADR 0015 — Tool-calling agent loop running story-skills

**Status:** accepted · 2026-09-30 · supersedes ADR 0011 decisions 3, 6, and 7

## Context

ADR 0011 made skills prompt-injected instruction text: attached skills were pasted into a `## Skills` system message, and the model had no tools. It deferred a model-driven activation loop (phase 2) and native tool calling (phase 3), and it rejected tool calling because `packages/providers` had not ported it.

ADR 0014 makes a story-skills project the app's data model. The 23 story-skills skills are written for an agent that loads them on demand (their descriptions route requests to one another, and their `references/` folders load when needed), reads and writes the project's files, and runs the `story` CLI. Together the skills come to about 250 KB of `SKILL.md` and 340 KB of references, too much to inject wholesale. Injected into a tool-less chat, they would instruct the model to do things it cannot do.

The premise of ADR 0011's rejection no longer holds. SillyTavern at the port's baseline commit `29e0df488` already builds `tools`/`tool_choice` requests and normalizes tool-call deltas for nearly all ported sources, including OpenAI, Claude, Google, Mistral, OpenRouter, DeepSeek, Groq, xAI, NanoGPT, and custom OpenAI-compatible endpoints.

## Decision

1. **Port native tool calling into `packages/providers` from SillyTavern `29e0df488`.**
   - Request building accepts provider-neutral tool definitions and a tool choice.
   - The stream normalizer surfaces tool-call deltas.
   - The canonical message model gains assistant tool calls and `tool` result messages.
   - Each source advertises tool support, mirroring upstream `isToolCallingSupported`.
   - The package stays pure and follows ADR 0005's port rules.
2. **The server runs a bounded agent loop.** A turn repeats the cycle of calling the model, executing the tool calls it returns, appending the results, and calling the model again. It ends when the model answers with no tool calls, when the user stops it, or when it reaches a step limit. Every model request, tool call, and tool result is appended to the exchange's immutable snapshot (`contextVersion` 3) and streamed to the browser.
3. **Skills use progressive disclosure through tools.** The system prompt carries the skill catalog, names and descriptions only. The model loads a skill body with `activate_skill` and a reference file with `read_skill_file`. Pinning a skill to a chat preloads it.
4. **The agent reads and writes.** Its tools cover the whole workspace a book belongs to. For a series, that means the current book, its sibling books, and the series bible.
   - It can list, read, search, create, edit, and delete files.
   - It can run the `story` CLI, including the commands that write: `add`, `rename`, `move`, `remove`, `reindex`, `export`, `build`, and the others.
   - All paths are confined to the book or series root. The CLI never runs through a shell, and the model never supplies `--path` or `--out`. The server targets the book the tool call names.
5. **Every agent write is visible and reversible.**
   - Each turn's writes are grouped into one checkpoint that records the prior contents of every file touched, including files changed by CLI commands.
   - The turn ends with a change summary: files created, edited, and deleted, each opening a diff.
   - The latest checkpoints can be undone one by one.
   - Writes happen under the book's write lock, with an expected-hash check against concurrent edits.
   - An optional **review mode** holds the agent's writes as a pending changeset until the user applies them. Commands are previewed on a scratch copy so the user sees the real file effects. The setting is global, with a per-chat override, and it is off by default.
6. **story-skills is the bundled skill set.** Installing skills copies the pinned story-skills skills, `references/` included, into `data/skills/` with `origin: story-skills@<version>`. The skill text stays upstream-verbatim. A short runtime preamble maps the skills' CLI instructions to the `run_story` tool. The jwynia-adapted starter set is removed. The two worldbookllm-original skills, `skill-creator` and `game-facilitator`, are not shipped in this milestone. They stay in git history for later integration. Skills already installed in a user's data directory are left alone.
7. **Providers without tool calling get plain chat.** Plain chat is a single request with pinned files and pinned skills injected. The agent is the default wherever the configured source supports tools.

## Rationale

Porting SillyTavern's tool calling keeps the project inside its established provider boundary and gives every supported provider one code path. A text-sentinel protocol would be fragile across models and would need replacing anyway. Running story-skills as written, rather than rewriting it for a tool-less chat as we did with jwynia's skills, keeps us on an actively released upstream and uses what makes it valuable: skills that call deterministic CLI checks. An agent that cannot write would reduce story-skills to advice. Checkpoints with per-turn diffs and undo let the agent do real work while the writer stays in control of canon, and review mode covers writers who want to approve every edit.

## Consequences

- An agent turn costs several model calls. The step limit and the snapshot make that cost bounded and visible.
- `packages/providers` grows a tool-calling surface that must track upstream fixes. The e2e stub provider must speak tool calls.
- A turn can change many files at once. Checkpoints and the change summary are what keep that safe, so undo must cover CLI-made writes as well as direct edits.
- Process execution and path confinement become security-relevant server code with dedicated tests.
- The Prompt Inspector's guarantee that it shows exactly what the model received now covers a sequence of requests rather than one.
