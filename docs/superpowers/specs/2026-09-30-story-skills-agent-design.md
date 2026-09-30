# Story-skills agent

**Date:** 2026-09-30

**Status:** Proposed

**Decision record:** ADR 0014 (`docs/decisions/0014-story-skills-agent-loop.md`)

## Purpose

Replace the prompt-injected starter skills with [story-skills](https://github.com/danjdewhurst/story-skills)
run the way it was written: by an agent that loads skills on demand, reads and proposes changes to
a Markdown story project, and uses the `story` CLI for mechanical checks. This is ADR 0011's
phases 2 and 3 done in one move, using native tool calling ported from SillyTavern.

## What story-skills provides (v0.18.0, 2026-09-29)

- **23 skills.** Each is a `SKILL.md` with `name` and `description` frontmatter plus a `references/`
  folder. Descriptions list trigger phrases and "NOT for" redirects, so a model can route requests
  from the catalog alone. Sizes range from about 6 KB (`theme-craft`) to about 32 KB (`story-maintenance`).
- **The `story` CLI** (`bin/story.js`, Node ≥ 18, no runtime dependencies). It has about 35 commands.
  The check and analysis commands support `--json`, which prints an envelope
  `{ ok, data, diagnostics }`. Exit codes are 0 (ok), 1 (findings), 2 (usage error),
  3 (unusable project), and 4 (write refused). The package has no programmatic API.
- **The project format (schema v2).** `story.md` marks the root. Each directory has one file per
  entity, the filename is the kebab-case id, and `_index.md` registries are generated. The full
  contract is in upstream `docs/project-format.md`.

## Architecture

```
browser ──POST /api/chats/:id/messages──► AgentService.run(turn)
   ▲                                          │
   │ SSE: delta · tool_call · tool_result ·   ├─► assemble: system + catalog + pins + history
   │      changeset · step · done · error     ├─► providers.buildChatRequest(…, tools)
   │                                          ├─► stream, collect text + tool calls
   └──────────────────────────────────────────┤   for each tool call → ToolRegistry.execute()
                                              │     ├─ skills: activate_skill, read_skill_file
                                              │     ├─ knowledge: list/read/search sources
                                              │     ├─ project: list/read story files
                                              │     ├─ run_story (read-only allowlist)
                                              │     └─ propose_write / propose_story_command
                                              │          → pending changeset (no disk write)
                                              └─► loop until no tool calls, stop, or step limit
```

## Phase 1: tool calling in `packages/providers`

Follow `.claude/skills/providers-port`. The upstream sources at `29e0df488` are:

- `src/endpoints/backends/chat-completions.js` for per-source `tools` and `tool_choice` request
  shaping: OpenAI-style for most sources, Claude `tools`/`tool_choice`, and Google
  `functionDeclarations`/`toolConfig`.
- `src/prompt-converters.js` for tool-call and tool-result message conversion. The existing
  `MERGE_TOOLS`, `SEMI_TOOLS`, and `STRICT_TOOLS` processing types are already ported but have
  nothing to process yet.
- `public/scripts/openai.js` and `public/scripts/tool-calling.js` for streamed tool-call delta
  accumulation per source, and for `isToolCallingSupported`.

Shared types gain the following:

```ts
type ToolDefinition = { name: string; description: string; parameters: JsonSchema };
type ToolCall = { id: string; name: string; arguments: string /* raw JSON */ };
// Message: assistant messages may carry toolCalls; new role 'tool' with toolCallId + content.
// StreamDelta gains toolCalls?: Array<{ index: number; id?: string; name?: string; argumentsDelta?: string }>
```

The phase is done when every source that upstream marks tool-capable builds a correct request
from the same `ToolDefinition[]`, streams round-trip tool calls in fixture tests, and
`supportsTools(source)` is exported. The NanoGPT smoke test gains a single tool round trip.

## Phase 2: agent loop and read-only tools

`AgentService` sits next to `GenerationService`. A chat becomes an agent chat when three
conditions hold: the configured source supports tools, the global setting `agent.enabled` is on
(default on), and the notebook has a story project or the chat has at least one skill available.
Every other chat runs through the existing single-request path, unchanged.

**The loop.** Steps are capped at `agent.maxSteps` (default 12). The model's text streams to the
user as it does today. Tool calls in one assistant turn run sequentially, in the order given.
Each tool result goes back to the model as a `tool` message, truncated at 24 KB and marked
`[truncated: N bytes omitted]`. A stop request aborts both the in-flight model call and the
running tool call. When the step limit is reached, the final message says so. The existing
one-generation-per-chat lock covers the whole run.

**System prompt.** The prompt contains four things:

1. The runtime preamble.
2. A `## Skills` catalog of every installed skill, listing name and description only.
3. The bodies of any pinned skills.
4. Project facts: whether a story project exists, its title, and the notebook's source count.

The preamble tells the model:

- The `story` CLI is available only through `run_story`, and never through `bun`, `node`, or `npx`.
- Files change only through proposals that the user reviews.
- It must ask the user before inventing canon. This rule already appears throughout story-skills.

**Tools.** The model sends arguments as JSON Schema, and the server validates them with zod.

| Tool                 | Arguments           | Behavior                                                                                                                          |
| -------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `activate_skill`     | `name`              | Returns the skill's `SKILL.md` body and lists its `references/` files. The result is recorded in the snapshot.                    |
| `read_skill_file`    | `name`, `path`      | Returns a file under that skill's folder. The path must resolve inside the folder, and only `.md` files up to 64 KB are allowed.  |
| `list_sources`       | `category?`, `tag?` | Returns id, title, category, tags, and size for the notebook's sources.                                                           |
| `search_sources`     | `query`, `limit?`   | Runs the existing FTS5 search and returns ids, titles, and snippets.                                                              |
| `read_source`        | `id`                | Returns the source's Markdown content.                                                                                            |
| `list_project_files` | `dir?`              | Lists the story project tree, relative paths only.                                                                                |
| `read_project_file`  | `path`              | Returns a project file. The path must be relative, must stay inside the project root, and must not traverse into dot-directories. |
| `run_story`          | `command`, `args[]` | Runs an allowlisted read-only command and returns the JSON envelope, or text for commands without `--json`, plus the exit code.   |

The read-only `run_story` allowlist contains `validate`, `links`, `continuity`, `knowledge`,
`context`, `compare`, `similarity`, `progress`, `timeline`, `prose`, `series`, `report`, `next`,
`doctor`, `pacing`, `clues`, `voices`, `names`, `diagram` (without `--out`), `passes` (without
flags that write), `wordcount` (without `--write`), and `synopsis` (without `--out`). Arguments
are validated per command against an option table built from upstream `docs/cli-reference.md`.
`--path` and `--out` are never accepted from the model.

**Process execution.** The server calls
`execFile(process.execPath, [storyBin, command, ...args, '--path', root, '--json'?])`.

- `cwd` is the project root.
- The timeout is 20 s and output is capped at 1 MB.
- `env` is reduced to `PATH`, `HOME` (pointed at a temporary directory), and `NO_COLOR=1`.
- `storyBin` resolves from the exact-pinned `story-skills` dependency.

A non-zero exit is data for the model, not a server error. Exit codes 2 and 3 come back to the
model as findings it can correct.

**Snapshot.** `contextVersion: 3` adds `steps[]`. Each step records the canonical messages sent,
the secret-free effective request body, the assistant text and tool calls, and each tool's name,
arguments, result (post-truncation), duration, and exit code. Versions 1 and 2 still validate.

**SSE events** (added to `StreamEvent`):

- `tool_call {stepIndex, id, name, arguments}`
- `tool_result {stepIndex, id, ok, summary}`
- `step {index}`
- `changeset {id, files}`

**UI.** Tool activity renders inline in the assistant message as collapsed rows: "Loaded skill
worldbuilding", "Ran `story continuity`: 2 warnings", and "Read characters/sera-voss.md". Each row
expands to show the arguments and result. The Prompt Inspector gains a step selector.

## Phase 3: story projects in notebooks

- **Opt in.** `POST /api/notebooks/:id/story-project { title }` runs `story init` into
  `data/notebooks/<id>/story/`. Import is a separate action that runs `story import <file>` on an
  uploaded manuscript.
- **Index.** The `story_files` table stores path, kind, id, title, hash, and mtime, with FTS rows
  in a sibling standalone table following ADR 0012. Out-of-band edits reconcile on access the
  same way sources do. The files remain the source of truth.
- **Story tab.** The tab has a registry-aware tree (Characters, World, Plot, Chapters, Scenes,
  Continuity, Glossary), a Markdown viewer and editor that reuses the source reader, and a Health
  panel. The panel shows `story report --json` checks and `story next` recommendations, and
  refreshes after every applied changeset.
- **Out of scope for this phase:** converting sources into entities, multi-book series
  directories (they come later via `story series`), and `.github/` templates.

## Phase 4: changesets and write tools

| Tool                    | Arguments                     | Behavior                                                                                                                                                                                                     |
| ----------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `propose_write`         | `path`, `content`, `reason`   | Stages a full-file create or replace in the chat's open changeset. It never writes to disk.                                                                                                                  |
| `propose_story_command` | `command`, `args[]`, `reason` | Stages a CLI command that writes: `add`, `rename`, `move`, `remove`, `reindex`, `wordcount --write`, `progress --log`, `passes --init/--start/--done`, `export`, `build`, `synopsis --out`, `diagram --out`. |

**Preview.** Staged commands are previewed by running them against a scratch copy of the project,
then diffing the copy against the live tree. The user reviews the actual file effects, not a
description of them.

**Review.** A changeset is shown as per-file diffs with an Apply button for each file and for the
whole set. When a turn ends with a changeset still open, the assistant message ends in a changeset
card.

**Applying.** Applying a changeset does three things in order:

1. It checks each file's hash against the hash recorded when the change was staged, and refuses
   with a conflict if a file changed since.
2. It writes atomically, using the source writer's temp-file-and-rename approach.
3. It records a checkpoint of the prior contents in `story_checkpoints`, which supports a
   one-click undo of the most recent applied changeset per notebook.

After applying, the server re-indexes and runs `story reindex` and `story validate`, and shows the
results.

**Next turn.** The model sees the outcome (applied, partially applied, or rejected, with the
user's note) as a system message at the start of the next turn.

**Skill guidance.** Skills that normally write directly are covered by the preamble line "Stage
every file change; the user applies them." Upstream text is not rewritten.

## Phase 5: replace the starter set

- Add `story-skills` as an exact-pinned dependency of `apps/server`. Its MIT license text ships in
  the package. `THIRD_PARTY_NOTICES` or `ATTRIBUTION.md` records the version.
- "Install Story Skills" copies `node_modules/story-skills/skills/*` into `data/skills/<name>/`,
  `references/` included. Frontmatter gains the managed keys `id`, `origin: story-skills@0.18.0`,
  and timestamps. Existing names are skipped. An upgrade path shows a diff for skills whose
  content differs from a newer pinned version.
- `SkillFiles` preserves and serves `references/` through `read_skill_file`. The UI shows
  references read-only beside `SKILL.md`.
- Delete `apps/server/skills-starter/` (the jwynia adaptations, `LICENSE`, and `ATTRIBUTION.md`),
  the kind contract test, and the `metadata.mode` handling. `skill-creator` and `game-facilitator`
  are worldbookllm-original, so decide separately whether to keep them as local extras.
- The Skills page groups skills by origin and marks upstream skills whose `SKILL.md` was edited
  locally.

## Testing

- **providers.** Fixture tests per tool-capable source cover request shape, message conversion,
  and streamed tool-call accumulation. There is one NanoGPT live smoke round trip.
- **server.**
  - A `ToolRegistry` unit test for each tool, covering path confinement (`..`, absolute paths,
    symlinks, dot-directories) and argument validation.
  - `run_story` tests against a fixture project copied from upstream `examples/`, checking the
    allowlist, rejected flags, timeout, and output cap.
  - `AgentService` tests with a scripted stub provider, checking the step limit, the stop
    request, and the snapshot shape.
  - Changeset tests covering the preview, hash conflict, apply, and undo.
- **e2e.** The stub provider learns scripted tool calls. The journey: create a story project,
  ask "create a character named Sera Voss", see `activate_skill` and `names` in the transcript,
  review and apply the proposed file, see the Health panel update, then undo.

## Security notes

- Tool arguments are untrusted model output: validate everything and resolve every path through
  a single `confine(root, rel)` helper.
- The server never uses a shell, never lets the model supply `--path`/`--out`, and never passes
  the process environment through.
- Source and project content can contain prompt injection. Writes are therefore gated by user
  review, and read tools cannot reach outside the notebook.
- The CLI version is pinned exactly. Upgrades are reviewed changes (see Phase 5).

## Build order and milestone

Phases 1 through 5 form a new roadmap milestone, **M7: Story-skills agent**. Each phase ships
behind `agent.enabled`, and the existing chat path is untouched until Phase 5 retires the starter
set.

## Open questions

1. **Providers without tools.** Should agent mode be unavailable for them (the current plan), or
   should a text-protocol fallback be added later?
2. **Lore-only notebooks.** Should a notebook with no story project still get agent mode over its
   sources and skills? The current plan says yes, with the project tools hidden.
3. **Original skills.** Should `skill-creator` and `game-facilitator` be kept as local extras?
4. **Approval granularity.** Is a per-chat "auto-apply proposals" toggle wanted, or should review
   always be required?
