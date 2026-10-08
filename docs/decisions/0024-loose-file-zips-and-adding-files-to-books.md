# ADR 0024 — Zips without story.md, and adding files to an existing book

**Status:** accepted · 2026-10-08 · amends ADR 0020, builds on ADR 0014 decision 5

## Context

ADR 0020 refused any zip without a `story.md` as "not a story-skills project". Writers more often have a folder of chapter files, or chapters with some notes, than a finished story-skills project, so the most common zip failed. Once a book existed there was also no way in the app to add files to it: the book import endpoints (`previews/file`, `imports`) had no UI, and they could not file a chapter.

story-skills 0.23.0's `story import` reads a folder of `.md`, `.markdown`, and `.txt` chapter files in natural name order (`chapter-2` before `chapter-10`, prologues first), including files in story-skills' own chapter layout.

## Decision

1. **A zip without `story.md` becomes a new book from its documents.** Its `.md`, `.markdown`, and `.txt` files are kept (same limits, path checks, and skip report as ADR 0020); other files are skipped and listed. Files in a notes folder (`research/`, `notes/`, `sources/`, `references/`, `bible/`, `lore/`, `world/`, `worldbuilding/`, `characters/`, `locations/`, `outlines/`, `plot/`, `planning/`) and files with story-skills entity frontmatter are filed as research notes or entities. Every other file is a chapter. The chapters are written to an operation-specific temporary folder (under their own file names, or, when names repeat, numbered in natural path order so no two collide) and passed to `story import`; with no chapters, the book starts from `story init`. The notes are then written with `BookService.writeImports` as one checkpoint. A zip with neither `story.md` nor any text file is still refused.
2. **`chapter` is an import kind.** A chapter entry runs `story add chapter <title>`, which numbers it after the book's last chapter, and the imported prose goes under `## Chapter Text` with `status: draft`. A leading heading naming the chapter is dropped, and `Chapter 3: The Harbor` is titled `The Harbor`, since the CLI numbers chapters itself. A file in story-skills' chapter layout brings only its own chapter text. Any other frontmatter is kept in an `## Imported Frontmatter` section outside the prose, so nothing disappears and nothing leaks into builds. Imports with chapters run `story wordcount --write` before reindexing. A series bible holds shared canon, so it refuses chapters, and the app does not offer them there.
3. **Kind suggestions consider the title, file name, and folder.** Entity frontmatter still decides first. Otherwise a chapter-like title or file name (`Chapter 3`, `ch02`, `Prologue`), a story-skills chapter file, or a `chapters/`, `manuscript/`, or `drafts/` folder suggests a chapter, and a notes folder suggests research.
4. **An existing book accepts a zip of documents for review.** `POST /api/books/:book/previews/file` accepts a `.zip`: each file a single upload could be (Markdown, text, HTML, PDF, lorebook JSON) is converted and previewed in natural path order. Each entry carries its own `origin` (`<zip>: <path>`, shortened from the zip name's end to fit 255 characters) and its file's `conversionNotes`, which `imports` records as that entry's provenance. A zip that holds a whole project is refused there; it imports from the library as a new book.
5. **The Project tab has "Add files".** The writer picks one or more files (Markdown, text, HTML, PDF, lorebook JSON, or a zip), reviews each entry's title, kind, and text, and adds the ones they keep as one undoable checkpoint.

## Consequences

- A zip of loose chapters imports in one step, and a writer can keep adding chapters and notes to a book without leaving the app.
- Folder names decide notes versus chapters in a loose zip. A notes file outside a recognized folder becomes a chapter; the writer can move it with `story move` or delete it, and the import report lists every file written.
- Adding a chapter appends; inserting one between existing chapters is still done with `story move` afterwards.
