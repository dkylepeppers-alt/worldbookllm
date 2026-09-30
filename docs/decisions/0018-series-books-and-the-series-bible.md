# ADR 0018 — Series live on disk as sibling projects with a series bible, addressed by slug

**Status:** proposed · 2026-09-30 · implements the spec's phase 5 (ADR 0014)

## Context

ADR 0014 made each book a story-skills project under `data/projects/<slug>/`, and the story-workspace spec (`docs/superpowers/specs/2026-09-30-story-workspace-design.md`, "Series and the series bible") laid out series: books as sibling folders under `data/series/<id>/`, linked by `follows`/`precedes`, beside a `series-bible/` project that holds shared canon. It fixed the identity/book-local field split and the push, pull and carry operations, and the layout was checked against the pinned 0.18.0 CLI.

What the spec leaves open is how that layout fits the code M7 has built since. Everything that knows about a book keys it by slug: the book index, checkpoints, agent chats and changesets (`book TEXT` columns), the API (`/api/books/:book/…`), and `BookFileStore.root(slug)`, which resolves only `data/projects/<slug>`. A series also needs a place to edit its bible, a rule for multi-book writes, and an agent scope that does not let one chat's turn rewrite a whole series by accident.

## Decision

1. **Slugs stay the only identifier, across the whole data directory.** A book keeps its slug whether it is standalone or in a series, so moving a book into a series changes no database row. Book slugs and series ids share one namespace and must be unique across `projects/` and every `series/<id>/`. Creating a book or series refuses a taken slug. If folders on disk collide (edited outside the app), the library lists the later ones, in path order, as conflicts and does not open them.
2. **`BookFileStore` resolves a slug by scanning, not by path arithmetic.** It finds `projects/<slug>/story.md`, `series/<id>/<slug>/story.md`, and `series/<id>/series-bible/story.md`, caches the map, and rescans on a miss. `confine` still applies within whichever root is found. The bible is addressed as the book whose slug is the series id, so the book index, file editor, checkpoints, history and undo all work on it unchanged. `BookSummary` gains `kind: 'book' | 'series-bible'`.
3. **Series metadata lives in the files.** A series is its folder: its bible's `story.md` (`series: <id>`, title, `## Series Notes`) plus the books under it, ordered by `book-number` and then by their `follows`/`precedes` links. No SQLite table owns series; the index may cache what the files say.
4. **The identity/book-local field map is code, pinned to the story-skills version.** `apps/server/src/story/series-fields.ts` holds the spec's table for 0.18.0. A test checks every field it names against the vendored `story.schema.json`, so a story-skills upgrade that renames a field fails CI instead of silently syncing the wrong thing. Fields the map does not list are book-local.
5. **Every sync write is a checkpoint in the book it changes.** A push to several books makes one checkpoint per book, with a shared label ("Series sync: sera-voss → Book Two, Book Three"), and each can be undone on its own. Push, pull and carry take every affected book's lock, in slug order, and write only after all of them are held. Afterwards each changed book gets `story reindex` and `story validate`. A validate failure in any book rolls back that sync in every book it touched.
6. **Structural operations move folders under locks.** Converting a standalone book into a series moves `projects/<slug>` to `series/<id>/<slug>` and runs `story init` for the bible. Adding a book runs `story init --follows|--precedes|--series` inside the series folder. Both refuse while an agent turn is running on an affected book. Removing a book from a series moves it back to `projects/`.
7. **The agent stays bound to one book, and reaches the series through read tools and one sync tool.** A chat on a series book (or on the bible) gets read-only access to the bible and its sibling books: `read_file`, `list_files` and `search` take an optional `book` limited to that series. Writes to other books go only through `sync_series`, which runs the push, pull or carry operations above and produces their checkpoints. `write_file`, `edit_file` and `run_story` keep writing only to the chat's own book. In review mode, `sync_series` is refused like `story build` (ADR 0016), because a multi-book changeset is out of scope for now.

## Rationale

Keeping the slug as the identity is what makes this cheap. Every table, route and component built in M7 already speaks slugs, and none of them has to learn about series folders. Treating the bible as a book-addressed project reuses the whole editing, history and undo surface instead of building a second one for canon. The folder layout is upstream's own convention, so the files stay usable with the `story` CLI outside the app, which ADR 0003 requires.

We considered giving series books compound identifiers (`<series>/<book>`). That would have rewritten every `book` column, route and checkpoint path, and every move into or out of a series would have changed a book's identity. We also considered a `series` table in SQLite as the source of truth, but that breaks the rule that files on disk are canonical and the database can be rebuilt.

Limiting the agent's cross-book writes to `sync_series` keeps a turn's effects legible. A turn's change summary lists the books a sync touched, and each book's history shows its own checkpoint, instead of edits spread across books by generic file tools.

## Consequences

- Slugs must now be unique across series too. The create-book and create-series forms check for this, and a clash from outside the app shows up as a library conflict rather than a crash.
- A book's path on disk depends on where it lives, so tools and tests that assumed `data/projects/<slug>` (the Docker smoke test, e2e disk checks, the verify skill) must ask the store, or use standalone books.
- Undoing a multi-book sync is per book. A writer who wants the whole sync gone undoes it in each book; the shared label makes the set easy to find.
- The field map has to be updated whenever the pinned story-skills version changes, and the schema test enforces that.
- Review-mode chats cannot sync until changesets span books, which is a later decision.
