# ADR 0027 — Edit chapter choices in the app and play the ink build with inkjs

**Status:** accepted · 2026-10-09 · builds on ADR 0014

## Context

story-skills 0.23.0 turns a book into interactive fiction from the `choices` in its chapters' frontmatter: `story build --format twee` writes Twine, `--format ink` writes ink for inkle's tools (Inky, inklecate, inkjs). Writers had to edit that YAML by hand, learn the branching rules (the first chapter starts; once any chapter has a choice, a chapter without one is an ending) from the build's refusals, and leave the app to try the result. ink is the interactive format writers here care about most, and the only way to know a build's ink plays is to compile and run it.

## Decision

1. **Branches are read from the chapter files, not stored.** `GET /api/books/:book/branches` reads each chapter's `choices` as story-skills' `chapterChoices` and `branchGraph` do: order by `number`, the first chapter starts, links are the choices once any exist, and what no path reaches is flagged. Nothing is indexed or cached beyond the existing file index.
2. **Choices are written into the chapter file.** `PUT /api/books/:book/chapters/:id/choices` replaces only the `choices` block of the frontmatter, leaving other lines and comments as written. If that edit would not parse back to exactly the intended data it rewrites the frontmatter whole, and it refuses frontmatter that does not parse. It goes through the ordinary file write: the hash the choices were read with must still match, and the edit is a checkpoint.
3. **Play runs the real ink build.** `GET /api/books/:book/play` runs `story build --format ink` into an operation-specific temporary folder (never `dist/`), compiles the result with **inkjs** on the server (counting every visit), and returns the ink source, the compiled JSON, and each chapter's knot name. The browser runs that JSON with the inkjs runtime, loaded only by the Play screen. A build refusal or an ink compile error is shown, not worked around.
4. **inkjs is pinned exactly in the workspace catalog** and used by both apps, so the compiler that writes the JSON and the runtime that reads it always agree on ink's story format.
5. **The IFID can be pinned in one step.** `POST /api/books/:book/ifid` writes the IFID the build already derives into `story.md`, so retitling the book keeps it; a fresh one is used only when the book cannot build.

## Rationale

- Re-implementing story-skills' prose extraction to play chapters directly would drift from the pinned package (outline sections, `## Chapter Text`, comments) and could show text no build has. Playing the build's own output cannot.
- inkjs is inkle's maintained JavaScript port of the ink runtime and compiler (MIT), the engine Inky's web export uses; compiling in Node needs no .NET inklecate binary. Compiling on the server keeps the compiler (about 250 KB) out of the browser; the runtime alone is about 130 KB and loads with the Play screen.
- Replaying the choices made from the start (kept in the address as `?path=1.0`) is deterministic for the ink story-skills writes, so Back, reload, and links work without saving ink state.

## Consequences

- The Play screen shows exactly what an ink build does, including upstream rendering issues: story-skills 0.23.0's ink build joins a heading inside a chapter, and list items, into the paragraph around them. Fixes belong upstream.
- An upgrade of inkjs is one catalog change; the server tests compile and run a real build, and the web tests run compiled ink.
- Writer-added ink logic (variables, conditions) lives in a hand-edited copy under `adaptations/interactive/` per the adaptation skill; Play does not run those files.
