# ADR 0030 — Interactive books are written in ink

**Status:** accepted · 2026-10-12 · supersedes ADR 0027 decisions 1–2, ADR 0028 decisions 2, 5 and 6, and ADR 0029 decisions 1 and 5

## Context

Interactive books were Markdown novels with `choices` in chapter frontmatter, plus worldbookllm's `sets` and `requires` flags (ADR 0027, 0028). Play ran story-skills' Twine and ink builds, read each chapter's prose back out of the Twine, and wrote ink from it. That limited a book to chapters that end in choices leading to other chapters, with true/false flags: no choice inside a scene, no prose that changes with what the reader did, no numbers or lists, no way to publish the story playable. Twine was kept only because story-skills builds it, and story-skills' rules decided what an interactive book could be.

Interactive fiction is meant to be a first-class kind of book here, and ink is the format writers care about. Twine is not a goal, and story-skills does not have to define interactive books.

## Decision

1. **A book is interactive when story.md says `interactive: true`.** It replaces "has an IFID or any chapter has choices". story.md keeps the `ifid`, set when the book becomes interactive.
2. **An interactive chapter's body is ink.** The chapter file is one knot: its frontmatter (title, number, status, …) is unchanged, and its body is the knot's content, stitches (`= cellar`) included. worldbookllm adds the `=== knot ===` line and a `# chapter: Title` tag when it assembles the story, so a chapter's heading cannot drift from its file.
3. **Knot names are what writers divert to:** the chapter id with `-` as `_`, and a leading `_` for one that starts with a digit or is a word ink reserves (`chapter-03` is `chapter_03`). The writer's text is never rewritten on the way to the compiler, so line numbers and behaviour match Inky exactly.
4. **Ink that is not a chapter lives in Markdown files under `ink/`**: global `VAR`, `CONST`, `LIST`, and `EXTERNAL` declarations, functions, shared tunnels and knots, and, if the writer wants one, the opening divert. Their bodies are ink, like chapters, and they are included in name order. Keeping them Markdown keeps every book file editable, indexed, checkpointed, and visible like any other.
5. **Ink owns the start of a line**: `*` and `+` choices, `-` gathers, `~` logic, `=` stitches, `#` tags, `->` diverts, `//` comments. Inline Markdown (`*emphasis*`, `**strong**`) still renders, each ink line is a paragraph, and a line that is only the tag `# break` is a scene break. A Markdown heading or list is written escaped (`\# Heading`), as the converter writes them.
6. **worldbookllm assembles, compiles, and reads the story itself.** It reads the chapters in order (`number`, then file name), builds one ink story from them with inkjs's compiler (each chapter an included file, so errors name the chapter file and line), and reads the compiled story's structure: knots, stitches, choices and their conditions, diverts, variables read and written. Play, the map, the choices screen, Health, and the exports all use that structure. story-skills' Twine and ink builds are no longer used for interactive books, and Twine is not offered for them.
7. **Exports are ink's own:** one `.ink` file that opens in Inky, the compiled `.json` for game engines, and a web page that plays the story with inkjs's runtime inlined, needing nothing else.
8. **Existing interactive books convert once, visibly.** Each chapter's Markdown becomes ink, its frontmatter `choices` become ink choices (`sets` become `~` assignments, `requires` conditions), flags become `VAR`s in `ink/variables.md`, and story.md gets `interactive: true`. The conversion is one checkpointed change the writer previews as a diff and can undo. "Make it interactive" and interactive editions convert the same way.
9. **story-skills still works on interactive books where it reads prose.** Its index, chapter numbering, and checkpoints are unchanged. Its prose checks and the search index read a projection of each chapter: the text a reader could see on any path, without ink's markup.

## Consequences

- Writers have all of ink: choices inside scenes, weaves and gathers, conditional and varying text, numbers, strings, lists, functions, tunnels, threads, and tags, with inkle's "Writing with ink" applying as written.
- A chapter in an interactive book is not a Markdown chapter: headings and lists are written escaped, and a `//` in prose (a web address) starts an ink comment unless escaped.
- The story-skills parity tests for ink (ADR 0028 decision 6) and the Twine round trip are gone; worldbookllm's tests decide what an interactive book does.
- story-skills' branching findings (`invalid-choice`, `unreachable-chapter`) no longer describe interactive books; worldbookllm's compile diagnostics and structure checks replace them.
