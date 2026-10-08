# ADR 0026 — One reviewed import pipeline for new and existing books

**Status:** accepted · 2026-10-08 · supersedes ADR 0024 decision 1, builds on ADR 0014 decision 5

## Context

There were two import paths. Adding files to an existing book converted, previewed, and wrote only what the writer kept (ADR 0024). Creating a book from a manuscript or a loose zip ran `story import` straight into the library, with no review: the writer could not see or fix the chapter split, `story.md` held guesses (genre `fiction`, no `form` or `target-words`), the synopsis placeholder named a temporary file, and the suggested character and place names were printed once and lost. New books also took fewer formats than existing ones, an added file became exactly one entry however many chapters it held, and an added chapter could only go at the end.

## Decision

1. **Every import goes convert → split → review → write.** One server step (`previewDocuments`) converts each file, suggests each entry's kind, and splits manuscript files into chapters, in natural path order and without writing to the library. Both the new-book and the existing-book preview use it, so they take the same formats: Markdown, text, HTML, PDF, lorebook JSON, and zips of them.
2. **Chapters are split by `story import` itself, in a temporary folder** (`story/manuscript-split.ts`). Each document is imported on its own so every chapter keeps its file's provenance (up to four at a time), and one `--dry-run` over all of them gives the recurring names. The folder is removed whatever happens. The writer can pick the heading language (English, Spanish, French, German) and the preview is read again. For an existing book, only a chapter file with at least two chapter headings is split.
3. **A new book is created from the review.** `POST /api/books/import/preview` returns the entries and name candidates, or reports a whole story-skills project. `POST /api/books/import/create` runs `story init` with the writer's title, form, genre, POV, tense, and synopsis, sets `language` and `target-words` in `story.md`, and then writes the entries with the same `writeImports` as an existing book, as one checkpoint. If that write fails, the new book goes to the trash. `POST /api/books/import` now takes only a zip with `story.md` (ADR 0020).
4. **Chapters are written as `story import` would write them.** An untitled chapter is headed `# Chapter N`, a prologue or other unnumbered chapter gets `numbered: false` and its title alone, and a story-skills chapter file keeps its `author`.
5. **Chapters can be placed.** In an existing book a chapter goes after the last chapter, before chapter N (later chapters are renumbered with `story move`, highest first, then `story add chapter --number N`), or in place of chapter N's prose, keeping its frontmatter and outline. Numbers are the book's as reviewed, and earlier inserts in the same import are accounted for. Every target is checked before anything is written.
6. **The suggested names are kept.** A new book's import writes an `Import report` research note listing the candidate names and any skipped files, so the writer and the agent can build the bible from it later.
7. **The Agent tab guides building the bible.** A book with chapters and an import report, or chapters and no bible, gets a "Build the bible" guide: cast and world from the import report, then each chapter's cast and scene records five chapters a turn, then open threads and continuity state, then `story check`. Each step puts a prompt in the composer for the writer to edit and send, so nothing runs without them, and each turn is one undoable change. Steps tick off from the book's files (bible entries, scene records, threads), and the guide can be hidden per book. The import report links to it.

## Consequences

- Nothing reaches the library before the writer has seen it, for a new book as for an existing one.
- A preview of a long zip runs one `story import` per manuscript file. Four run at a time; a 60-chapter zip takes a few seconds.
- The review screen can reorder entries, but splitting or merging chapters during review is not offered; `story split` and `story merge` do it afterwards.
- Word, OpenDocument, and EPUB converters plug into the same convert step.
