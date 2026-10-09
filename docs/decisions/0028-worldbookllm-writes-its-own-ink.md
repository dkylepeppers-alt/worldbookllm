# ADR 0028 — worldbookllm writes its own ink, with choice state

**Status:** accepted · 2026-10-09 · supersedes ADR 0027 decision 3 (what Play runs), builds on ADR 0014

## Context

Interactive books are meant to be a first-class feature, and ink is the format that matters. story-skills 0.23.0's ink build had two limits we could not wait on, since we neither own nor contribute to story-skills:

- It runs a heading, list item, quotation, or table row inside a chapter into the paragraph around it.
- It has no state. Every chapter's prose is escaped so ink logic cannot run, and the adaptation skill's answer, hand-editing a copy of the built file, forks the story from its chapters.

story-skills is MIT licensed, its ink writer is about 150 lines, and its validator and builds ignore keys on a choice they do not know.

## Decision

1. **worldbookllm writes the ink** (`apps/server/src/story/ink/ink-writer.ts`), starting from story-skills' `src/ink.js` with attribution: the same knot names, escaping, global tags, sticky choices, and endings. The syntax follows inkle's "Writing with ink" and "Running your ink".
2. **story-skills still assembles the prose and refuses broken choices.** Play and the ink build run `story build --format twee`, whose passages hold each chapter's prose exactly as every build assembles it with its lines intact, and `story build --format ink` for the title, author, and IFID. Both go to an operation-specific temporary folder. The paragraph rules (scene breaks, code fences, soft breaks between Chinese or Japanese text) are vendored from story-skills' `markdown.js` as `story-skills-markdown.ts`.
3. **Our writer improves on the upstream output:**
   - A heading, list item, quotation, table row, or fenced code line keeps its own line.
   - Each knot opens with a `# chapter: Title` knot tag.
4. **Choices carry state in their frontmatter:**
   - `sets: [found_coat, not lamp_lit]` becomes `~ found_coat = true` and `~ lamp_lit = false` after the choice.
   - `requires: [lamp_lit, not met_venn, chapter-03]` becomes conditions before the choice text; a chapter id tests its knot's read count.
   - Flags are declared `VAR flag = false`. A flag must be an ASCII ink identifier, not a word ink reserves, and not a chapter's knot name, because ink refuses a variable named like a knot. A chapter can be required, not set.
5. **Play and Project → Build → ink use the same writer.** The ink build runs story-skills' build for its file name, warnings, and refusals, then writes our ink over that file. Play is cached per book, keyed by every file's hash.
6. **Drift guard.** Tests compare our writer with the pinned story-skills on every path of every test story without the additions above, and the vendored Markdown helpers with the package's own. A story-skills upgrade that changes either fails a test instead of quietly diverging.

## Rationale

- Writing ink ourselves removes the wait on upstream without re-implementing prose extraction, which stays with the builds. The Twee build is the right source for the prose: it keeps each chapter's lines as written, where the ink build has already joined them.
- State on the choices keeps the chapters the single source of truth: no hand-edited copy, and moving or renaming chapters still goes through `story move`.
- Booleans and read counts cover the common branching patterns (branch and bottleneck, gauntlet, sorting hat) while staying something a writer edits in a form. Numbers, lists, and conditional text inside prose can come later in the same fields.

## Consequences

- The Twine build and story-skills' checks (`story continuity`, `story links`) know nothing of `sets` and `requires`: path checks treat every choice as always available. Branches says so.
- If story-skills designs its own state format, we migrate the frontmatter to it.
- Each Play or ink build runs two `story build`s. The cache keeps repeated plays cheap.
