# ADR 0017 — Retire notebooks and presets

**Status:** accepted · 2026-09-30 · supersedes ADR 0009; carries out ADR 0014 decision 6 and the starter-set removal implied by ADR 0015 decision 6

## Context

ADR 0014 made the story-skills book the top-level unit and promised that notebooks would migrate once, visibly. ADR 0015 and 0016 gave books an agent that reads and changes the book through tools. After those landed, the app still shipped the whole notebook era beside them: notebooks, flat sources, source-grounded chat, the preset studio with its prompt modules and assistant prefill, and the bundled starter skills. Two ways to do the same work confused the navigation, doubled the test surface, and kept alive a generation pipeline (ADR 0009) that the agent does not use. The one piece of a preset the agent did read was its generation controls, and its prefill had to be forced off because a prefilled assistant turn breaks tool calling.

## Decision

1. **Notebooks migrate at startup.** When the server becomes ready it moves every notebook that has no row in `notebook_migrations` into a new book, as ADR 0014 decision 6 describes. Each source becomes a research note that keeps its provenance, category and tags, plus any frontmatter keys the notebook app did not write. A source file that cannot be read is skipped and the rest still move. A failure is logged and never stops startup, and the next start retries whatever did not move. Once every notebook has moved, `data/notebooks/` is renamed to `data/notebooks.migrated/`, with a timestamp suffix if that name is taken.
2. **Notebook chats become agent chats.** Each chat is carried over to its book with its title, timestamps and messages. The first user message gets a note naming the research notes its selected sources became. Each response keeps the provider request body its exchange recorded as its single step, so the step inspector still shows what the model received. Streaming leftovers become interrupted messages.
3. **The move is reported once.** `GET /api/notebook-migration` lists each moved notebook with its book and counts. The book library shows that report until the writer dismisses it (`app_settings.notebook_migration_seen`).
4. **The notebook era is removed.** The notebook, source, chat, message and preset routes, their services, the prompt assembler, source organization, source search, and their UI are deleted, along with the starter skills and their install routes. `/books` is the home route. The notebook-era tables stay in SQLite, unused, so the move can be audited and no history is lost. Starter skills already installed stay in `data/skills/`, since they are the writer's files.
5. **Agent generation settings replace presets.** `app_settings.agent_generation_json` holds temperature, top-p, a per-step max-token cap, and thinking. Migration 013 seeds it from the default preset's controls. It is edited on the Settings page and sent with every agent step. Prompt modules and the assistant prefill are gone, not moved: the agent's system prompt is built by the server (ADR 0015), and a custom agent's instructions (ADR 0016) are how a writer shapes it.

## Rationale

A one-time server-side migration at startup, rather than a button, means no writer can be left on a notebook they cannot reach after the UI is gone. Its idempotence makes a crash mid-move safe. Carrying chats over with their recorded request bodies keeps ADR 0009's promise that a past exchange stays explainable, without keeping its snapshot schema alive. Keeping only the generation controls matches what the agent actually used. A preset's module ordering has no meaning when the server owns the prompt, and a smaller settings object needs no portable schema, import or versioning. Leaving the old tables in place costs a little disk space and avoids a destructive migration that could not be undone.

## Consequences

- There is one workspace, the book, and one generation path, the agent loop.
- A writer who used several presets keeps only the default preset's controls. The other presets survive only as rows in the unused `presets` table.
- Preset JSON import and export and `docs/PRESET_SCHEMA.md` are gone. A later export of agent settings or custom agents would need a new format.
- Starter skills already installed remain in `data/skills/` with `origin: bundled`, and the app no longer ships or updates them.
- Dropping the unused notebook-era tables, and the `bundled` skill origin, is left to a later migration once nothing reads them.
