# ADR 0014 — Story-skills projects replace notebooks

**Status:** proposed · 2026-09-30 · supersedes ADR 0003's notebook/source layout and the source-organization model (categories, tags, bulk organize)

## Context

worldbookllm was built as "NotebookLM for worldbuilding": a notebook holds a flat list of ingested Markdown sources with an optional category and tags, and chat is grounded in whichever sources the user selects. That model has no concept of the work being written. It knows nothing about chapters, scenes, point of view, who knows what by when, which promises are still open, or whether a dead character walks back on stage.

[story-skills](https://github.com/danjdewhurst/story-skills) (MIT, npm `story-skills`, Node ≥ 18, actively released) defines exactly that model as plain Markdown. `story.md` marks a project root. Each entity is one file, with its kebab-case filename as its id: characters, locations, systems, factions, artifacts, arcs, chapters, scenes, continuity questions, promises, and clues, glossary terms, front and back matter, and research notes. Registries (`_index.md`) are generated. A companion `story` CLI validates the project, rebuilds registries, and checks links, continuity, knowledge, timeline, pacing, and clues. It also packs spoiler-free drafting context, renames and moves entities while updating references, and builds manuscripts (Markdown, EPUB, DOCX, Shunn, print, narration, Fountain, Twine). Its 23 skills assume that layout. We want the app to be a complete, mobile-friendly workspace for that model, not a notebook app with story-skills bolted on.

Two properties of the format constrain us. Frontmatter supports only flat keys with scalar or list values, so a nested map fails `story validate`. Frontmatter also never carries a separate `id`, because the filename is the identity.

## Decision

1. **The story project is the top-level unit and replaces the notebook.** Each project is a story-skills schema v2 project at `data/projects/<slug>/`. The files are the source of truth, and the user can open the same directory in any editor, in git, or with the standalone `story` CLI.
2. **Identity is the project-relative path.** SQLite indexes projects and files by `(project, path)`, with kind, entity id, title, content hash, mtime, and the file's frontmatter as JSON. Full-text search follows ADR 0012's standalone-table pattern. Out-of-band edits reconcile on access. Renames performed through the CLI re-key the index.
3. **The `story` CLI is the only code that performs structural operations.** `story-skills` is an exact-pinned server dependency. The server runs `bin/story.js` through `execFile(process.execPath, …)` for init, import, add, rename, move, remove, reindex, the checks, and builds, taking a per-project write lock. We do not reimplement registry, reference, or continuity logic.
4. **App metadata in frontmatter is flat and prefixed.** Keys the app adds are flat (for example `origin-type`, `origin-url`, `origin-file`, `imported-at`). The app adds no `id` key.
5. **Ingestion files into the project as research notes by default.** The existing pipeline (paste, upload, PDF, HTML, SillyTavern lorebook and character-card JSON) still converts to reviewable Markdown. On save, it creates a `research/` entity carrying flat provenance keys, or another entity kind the user picks at review. A manuscript upload goes through `story import`.
6. **Notebooks migrate once, visibly.** A data migration creates a project per notebook with `story init`, writes each source as a research note (category and tags kept as the flat keys `legacy-category` and `tags`), and reindexes and validates. It rebinds chats to the project and leaves the original `data/notebooks/` tree in place, renamed to `data/notebooks.migrated/`, for the user to delete. Stored exchange snapshots are not rewritten.
7. **Structure comes from story-skills, not from categories.** Source categories, tags, the classification prompt, and bulk organize are removed. Entity kinds, registries, and cross-references carry organization.
8. **The UI is mobile-first and built from upstream's schema.** Entity editors render frontmatter fields from the pinned `schemas/story.schema.json` and the body as Markdown. User-initiated structural actions call the CLI directly, because the user is the actor. Model-initiated changes follow ADR 0015.

## Rationale

Adopting story-skills' format wholesale gives the app a real model of a story and a tested toolset for keeping it consistent. It keeps ADR 0003's core promise too, because the format is plain Markdown the user owns, and it is portable to any agent or editor that already speaks it. Delegating structure to the pinned CLI avoids a second, drifting implementation of registries and reference updates. Filing ingested material as research notes keeps the NotebookLM-style strength, grounding in the user's own material, inside the new model instead of beside it.

## Consequences

- The app's data model, API, and most screens are replaced. The provider layer, presets, snapshots, Prompt Inspector, PWA shell, and ingestion converters carry over.
- A story-skills upgrade is a deliberate, reviewed change: schema, CLI behavior, and skills move together. A future schema v3 needs `story migrate` plus our own index migration.
- Lore that is not yet part of a book fits as research notes and world entities in a project whose manuscript is empty.
- Metadata that needs nesting has to be flattened or kept in SQLite. Nested frontmatter is off the table while upstream rejects it.
- Existing users go through a one-time migration. Their original files stay on disk until they remove them.
