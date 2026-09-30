# Series and the series bible — implementation plan

**Date:** 2026-09-30
**Design:** ADR 0018, spec "Series and the series bible" (`docs/superpowers/specs/2026-09-30-story-workspace-design.md`), M7 handoff item 3
**Shape:** five PRs. Each merges green and leaves the app usable; a writer who never makes a series sees no change until S1's library grouping.

## S1 — Addressing and structure

- `BookFileStore`: scan `projects/*`, `series/*/*` and `series/*/series-bible` for `story.md`; slug → root map with rescan on miss; duplicate slugs reported, later ones in path order skipped. `listBooks()` returns `{ slug, root, seriesId, kind }`.
- Slug uniqueness across books and series ids in `BookService.createBook` and the new series create.
- `BookSummary.kind` (`book` | `series-bible`); `seriesId` already exists (from `story.md`), now also set from the folder.
- `SeriesService` (new, `apps/server/src/story/series.ts`): `list()`, `get(id)`, `create({ title })` (folder + `story init` for the bible with `series: <id>`), `convert(bookSlug)` (move under locks, init bible), `addBook(id, { title, follows | precedes | companion })` via `story init`, `removeBook(slug)` (move back to `projects/`). Refuse while an agent turn is active on an affected book (`AgentService` exposes `isRunning(book)`).
- Routes: `GET/POST /api/series`, `GET /api/series/:id`, `POST /api/series/:id/books`, `POST /api/books/:book/convert-to-series`, `DELETE /api/series/:id/books/:book`.
- Web: library groups a series (bible first, books in order); Project tab gets "Make this a series" and, in a series, "Add a book"; the bible opens in the normal book workspace with a "Series bible" label.
- Tests: store scan and collisions, convert/add/remove with checkpoints and index intact, slug clash, refusal during a running turn; library grouping.

## S2 — Field map, drift, and Series Health (read-only)

- `series-fields.ts`: the spec's identity/book-local table for 0.18.0; test asserts every field exists in the vendored `story.schema.json`.
- `SeriesService.drift(id)`: per entity kind and id, compare identity fields (frontmatter keys and named body sections) between the bible and each book that has the entity; report `{ entity, book, fields[] }`.
- Health: `story series --json` from one book plus `story links` on every book, merged with drift.
- Web: a Series screen (from the library and the bible's Project tab) with books, drift list, and health.
- Tests: fixture series (bible + two books) built with `story init`/`add` in a temp dir; drift on frontmatter and body sections; book-local fields ignored.

## S3 — Push, pull, carry, seed

- `push(id, entity, books[])`, `pull(id, entity, book)`, `carry(id, entity, book)`, `seed(id, fromBook)`: identity fields only; locks on all affected books in slug order; one checkpoint per changed book with a shared label; `reindex` + `validate` after, rolling back every touched book if any validate fails.
- Carry strips book-local references per upstream's "Carrying canon between books".
- Web: drift rows get Push / Pull; bible entities get "Carry into…"; converting offers "Seed the bible from this book".
- Tests: each operation's diff, book-local fields untouched, rollback on a forced validate failure, per-book undo.

## S4 — Agent series scope

- `read_file`, `list_files`, `search` accept an optional `book` limited to the chat's series (bible included); writes stay on the chat's own book.
- `sync_series` tool wrapping S3's operations; refused in review mode. System prompt gains the series outline (bible, books in order) for series chats.
- Change summary lists the books a turn's syncs touched.
- Tests: scripted-model turns that read the bible, push an alias, and are refused cross-book `write_file`.

## S5 — Journey and docs

- e2e (phone profile): convert a book, seed the bible, add a sequel, edit an alias in the bible, see drift, push it.
- Docs: `ARCHITECTURE.md` series section, `ROADMAP.md` M7 status, `DEPLOYMENT.md` backup note (series folders are under `data/series/`).
