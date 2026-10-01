# ADR 0019 — The style sheet is series-wide

**Status:** accepted · 2026-10-01 · amends ADR 0018

## Context

ADR 0018 split series canon into identity fields, owned by the series bible, and book-local state, owned by each book. It covered entities only, so every book in a series kept its own `style-sheet.md`. A series is written in one house style: its dialect, preferred spellings, watch-words, and voice are the same in every book. With a style sheet per book, nothing showed when the books drifted apart, and nothing could bring them back in line.

`story prose` reads the style sheet from the book it checks, and `story init` writes one into every new project. So the books cannot simply stop having a style sheet.

## Decision

1. **The bible's `style-sheet.md` is the series' style sheet.** Each book keeps a copy, so `story prose` keeps working book by book.
2. **It syncs as a whole file.** The style sheet has no identity/local split. Drift lists the frontmatter fields that differ and `body` if the prose differs. Push copies the bible's file over each chosen book's, pull copies a book's over the bible's, and carry is refused because every book already has one. It is addressed in `sync_series` and the drift list as `{ kind: 'style-sheet', id: 'style-sheet' }`, so it uses the same checkpoints, rollback, and UI as entity sync.
3. **New projects start aligned.** "Make this a series" copies the converted book's style sheet into the new bible, and a book added to a series starts with the bible's. Seeding the bible from a book leaves the style sheet alone; an existing bible's style sheet changes only through an explicit pull.

## Consequences

- A book that needs a deliberate exception to the house style shows as drifted until the exception is pulled into the bible or pushed away.
- Research notes, `plot/timeline.md`, and `continuity/` stay book-local, as before.
