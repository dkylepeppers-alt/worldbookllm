# ADR 0031 — The ink editor uses CodeMirror 6

**Status:** accepted · 2026-10-12 · builds on ADR 0030

## Context

Interactive books are written in ink (ADR 0030), and the only editor in the app was a plain textarea. Ink is a language: a writer needs to see choices, diverts, logic, and tags apart from prose, see the compiler's errors on the line they are on while typing, find a knot's name without leaving the file, and be warned about the traps Markdown habits set in ink (a web address's `//` silently starts a comment). A textarea can do none of it, and highlighting or inline errors cannot be laid over one accessibly.

## Decision

1. Interactive books' chapters and `ink/` files are edited in CodeMirror 6 (`@codemirror/state`, `view`, `language`, `commands`, `autocomplete`, `lint`, and `@lezer/highlight`), loaded only when such a file is first edited. Every other file keeps the textarea.
2. The highlighting is a stream language that knows where a file's ink is: frontmatter and a chapter's planning above `## Chapter Text` stay as written, and the ink below gets choices, gathers, knots and stitches, diverts, logic, tags, and comments.
3. As the writer types, the server compiles the story with the file's unsaved text (`POST /api/books/:book/ink-check`, which writes nothing). The file's errors and warnings are lint marks on their lines and a list whose entries move the cursor there; the ink's traps are warned about in the browser.
4. Completion offers knot and stitch names after `->` and variable names in logic, from the last check.
5. Colours come from the design tokens, so the editor follows the light and dark themes.

## Rationale

CodeMirror 6 is modular, accessible (its content is a labelled text box with keyboard navigation), small enough to load on demand, and has lint and completion built in. Monaco is several times larger, aimed at code IDEs, and weak on phones, where this app is mostly used. A stream language suits ink better than a Lezer grammar: ink's syntax is line-oriented, and the compiler, not the highlighter, is the source of truth about errors.

## Consequences

- Editing ink shows errors as they happen, without saving or opening Health.
- The web app gains CodeMirror as a dependency, loaded only for ink files.
- Each pause in typing compiles the whole story on the server; books are small enough that this is quick, but it is work proportional to the book.
