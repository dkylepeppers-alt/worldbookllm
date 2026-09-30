# ADR 0016 — Review mode staging and saved custom agents

**Status:** accepted · 2026-09-30 · implements ADR 0015 decision 5 (review mode)

## Context

ADR 0015 made the agent's writes apply immediately, with a per-turn checkpoint and undo, and promised an opt-in **review mode**: writes are held as a pending changeset until the writer applies them, and commands are previewed on a scratch copy so the writer sees their real file effects. It left open how the staging works, how a partial apply stays consistent with the generated registries, and how the model learns what the writer decided.

Writers also asked to save **custom agents**: a named role (a continuity checker, a line editor) with its own standing instructions and a narrower set of skills, reusable across books.

## Decision

1. **A review-mode turn works on a staged copy of the book.** At the start of the turn the server copies the book's folder, under the book lock and without `dist/` or dot-entries, to `data/staging/<uuid>/` (`StagedBook` in `apps/server/src/story/staging.ts`). All the agent's tools work on the copy through one `AgentWorkspace` interface: `read_file`, `list_files`, `search` (a plain substring scan, since the index does not cover the copy), `write_file`, `edit_file`, and `run_story` with `--path` set to the copy. The agent therefore sees its own proposed work, and CLI commands show their real effects. `story build` and `export` are refused in review mode, because their output lives in `dist/`, which is never proposed.
2. **The turn's changes become a changeset.** When the turn ends, including when it is stopped or fails, the Markdown files that differ from the copy's starting state become a changeset stored in SQLite (`agent_changesets`, `agent_changeset_files` with before and after bytes), and the copy is deleted. Generated `_index.md` registries are left out.
3. **The writer applies or skips per file, or all at once.** Applying writes the chosen files into the real book as one checkpoint (actor `agent`), so an applied change can be undone like any other. It then runs `story reindex`, so the registries match whatever subset was applied. Applying refuses, and writes nothing, when any chosen file is no longer as the turn found it. The writer can then skip that file or ask again.
4. **The outcome reaches the model at the start of the next turn.** When the next user message is stored, the app attaches a note (`agent_messages.note`) that lists which proposed files were applied, which were skipped, and which still await review. Fully resolved changesets are reported once; pending files are mentioned every turn until the writer decides. The note is prepended to that user message in every later request, so history rebuilds identically, and it is visible in the step inspector's request bodies.
5. **The setting is global with a per-chat override.** `app_settings.agent_review_mode` (default off) and `agent_chats.review_mode` (NULL follows the global setting). A chat picks the mode when it starts, and it can change between turns.
6. **Custom agents are saved rows, not files.** `custom_agents` holds a name, a description, instructions, and a skill list, where NULL means every installed skill. A chat names at most one agent (`agent_chats.agent_id`, `ON DELETE SET NULL`); a chat without one uses the default agent. The agent's instructions are added to the system prompt under `## Your role: <name>`. Only its skills appear in the skill catalog, and `activate_skill` and `read_skill_file` refuse any other skill. Custom agents do not choose a model: ADR 0013's single provider setting still applies.

## Alternatives considered

- **Stage writes in memory and overlay reads.** This would be cheaper than copying, but `run_story` could not preview commands (`add`, `rename`, `remove` rewrite many files), and that preview is what ADR 0015 requires.
- **Include registries in the changeset.** A partial apply would then leave registries describing files that were skipped. Regenerating them after every apply keeps them correct.
- **Store custom agents as Markdown files beside skills.** This would match the files-first rule for user content, but agents are configuration rather than creative content, like presets, which are also SQLite rows. They can be exported later if needed.

## Consequences

- A review-mode turn costs a copy of the book, which is text-sized for typical books. Copies are removed when the turn ends, and any left over are removed at startup.
- Search in a review-mode turn is a substring scan rather than FTS5 ranking.
- A changeset can go stale if the writer edits a proposed file first. Applying then reports a conflict instead of overwriting the edit.
- Deleting a custom agent returns its chats to the default agent; their history is kept.
