---
name: code-review
description: How to review a pull request in worldbookllm. Use when reviewing a PR or a diff in this repository. It covers what to read first, the invariants that matter here (book files as the source of truth, checkpoints, the story CLI boundary, ink, discovery, providers, the web design system), the bug patterns earlier reviews found, and how to write findings that are verified, specific, and worth acting on.
---

# Reviewing a worldbookllm pull request

A good review here finds the bugs that tests, lint, and types cannot: a broken invariant, a path through the code nobody exercised, or a state the feature can reach and mishandle. CI already runs `pnpm lint`, `format:check`, `knip`, `typecheck`, `test`, and the Playwright journeys. Do not spend findings on what those catch.

## Before you comment

1. **Read `AGENTS.md`** and every ADR in `docs/decisions/` that the diff touches or names. An ADR's numbered decisions are the spec. Code that contradicts one is a finding, unless the PR also updates the ADR.
2. **Read the PR description.** Check that the code does what it claims and nothing it says is out of scope.
3. **Read the changed code with its callers.** For every changed function, find who calls it and what they do with its return value. Many real bugs are in the caller, not the diff.
4. **Trace one realistic scenario per finding.** Name the input or state, the steps, and the wrong result. If you cannot write that scenario, leave the finding out.
5. **Check the tests.** For each behaviour the PR adds, ask whether a test would fail without the code. A missing test is worth a comment only when the untested path is risky.

## The invariants that matter here

### Book files are the source of truth (ADR 0003, ADR 0014)

- Books are Markdown on disk. SQLite is a rebuildable index; reads and other per-user conveniences may live there, content never. Flag any feature whose state only SQLite or memory holds when it should be visible in a file, and any that hides the writer's content from them.
- Only `apps/server/src/story/` reads or writes book files for their meaning, and only `StoryCli` spawns the pinned `story` CLI. Flag new `fs` writes to book paths, or `story` spawns, anywhere else.
- **Every write is a checkpoint** (`checkpoints.record`, a `CheckpointSession`, or `writeDiscover`) so it can be undone. Writes that skip one are findings.
- **Writes check what they read.** A write based on an earlier read must compare an expected hash (`expectedHash`, `expected` maps, `file_changed` conflicts). A read, a model call or other await, then a write with no check is a lost-update bug.
- **Writes that add or rename entities reindex** (`story reindex`, `needsReindex`). A failed reindex restores the snapshot. Registries (`_index.md`) and `dist/` are never written directly (`assertWritablePath`).
- **Frontmatter the app adds** is flat and JSON-quoted (`discover: "seed"`). Nested maps fail `story validate`.

### Interactive books in ink (ADR 0030–0033)

- Knot names come from `inkKnotName` (`chapter-03` → `chapter_03`, with a leading `_` for digits and reserved words). Flag hand-built knot names.
- Text written into ink is escaped with `inkText` or `inkLine`. User or model text with `{ } | # [ ] ~ ->` or `//` in it, written unescaped, corrupts the story.
- **Ink changes compile before they are written,** and a change that adds compile errors is refused, as in `setChapterEnding` and `writeDiscover`.
- `readEnding` decides whether a chapter's ending is one the choices form can edit. Code that rewrites endings must respect `editable` and keep the planning above `## Chapter Text`.
- **Discovery (ADR 0033):**
  - Whether a beat is a seed, edited, or stale is worked out from the files (`discoverBeats`: frontmatter plus the seed ink and hashes). Any code that decides from frontmatter alone disagrees with it.
  - Every path that writes choices goes through the structural checks (`checkBeat` / `checkChoices`) and the review pass.
  - Lead mode only writes while the setup says `lead`.

### The agent and the beat writer (ADR 0015, ADR 0016, ADR 0033)

- **Tool results are capped** (`truncateResult`), and tool errors go back to the model as results, not exceptions. Errors the model cannot fix, such as `ConflictError` and `NotFoundError`, must stop the run instead of looping.
- A turn's checkpoint is committed even when the turn fails or is stopped. In review mode, writes go to the staged copy only.
- Request bodies are recorded through `snapshotRequestBody`, which redacts secrets. Flag any new place that logs or stores a request, a key, or a provider error body without redaction.

### Providers (`packages/providers`, ADR 0005)

- This code is ported from SillyTavern under the AGPL. Use the `providers-port` skill's constraints: request shapes match upstream, and the package does no network I/O or key handling of its own.

### Server conventions

- ESM with NodeNext: relative imports end in `.js`.
- Request bodies and parameters are parsed with `z.strictObject` schemas from `@worldbookllm/shared`.
- Errors map to status codes in `routes/helpers.ts` (`ValidationError` 400, `NotFoundError` 404, `ConflictError` 409). A plain `Error` becomes a 500, so expected failures need the right class.
- Book operations take the book's `KeyedMutex` lock. Look for awaits of slow work, such as model calls, while the lock is held. Also look for read-then-write sequences that drop the lock between the read and the write without re-checking.

### Web (`apps/web`, `PRODUCT.md`, `DESIGN.md`)

- Colours come from tokens only; nothing is hard-coded, and red and green are status colours only. There is one accent, controls are at least 44px, and the writer's text is set in the prose serif.
- Every new screen must work at phone width, in light and dark mode, and by keyboard. Check focus, labels, and live regions for async status.
- **React hooks:** effect dependency lists must be complete and stable. Flag `eslint-disable` of `exhaustive-deps`, `setState` called directly in an effect, and objects or functions in dependency lists that are recreated on every render (loops of requests).
- Polling and requests clean up on unmount (`AbortController`, `clearInterval`).
- The UI must not offer an action the server is certain to refuse in that state.

## Bug patterns earlier reviews found here

When a diff has the same shape as one of these, check it carefully:

- **Mode or state transitions.** Switching a setting (lead to co-write, review mode on or off) while work is queued, so the queued work keeps running under the old mode.
- **Ignored results.** A function that reports failure through its return value (`{ done: false, problems }`, `null`, `exitCode`) and a caller that never reads it, then reports success.
- **Parsing with regexes.** Stripping comments or splitting text without respecting quoted strings or escapes (`"https://…"` cut off at `//`).
- **Derived versus stored state.** Two places that decide the same question differently: one reads a field, the other reads the content.
- **Partial enforcement.** A rule (a review, a validation, a permission) applied on three of four paths that write the same thing.
- **Retries and lists.** `find` where the newest entry is wanted (`findLast`), so a retry stays hidden behind the failure before it.
- **Reused components.** A route change that keeps the component mounted, so state or effects keyed on the old book or position carry over.
- **Remounts losing state.** Pending work tied to a component that unmounts while data reloads.
- **Unbounded model spending.** Background generation without a bound (look-ahead, step limits, dedupe of queued work).

## Writing findings

- Put the most severe first, and **one finding per root cause**. If the same mistake appears in three places, say so in one comment.
- **Each finding has:**
  - the file and line;
  - one sentence on what is wrong;
  - the concrete failure scenario (inputs or state → steps → wrong result);
  - the fix, with a short patch when it is small.
- **Severity:**
  - **High:** data loss or corruption, writes outside checkpoints, a security or secret leak, or a broken invariant above.
  - **Medium:** wrong behaviour on a realistic path, or a missing check on one path of several.
  - **Low:** edge cases, unclear errors, small UX gaps.
  - Leave out style nits that Prettier, ESLint, or knip already enforce, and personal preferences.
- **Say how sure you are.** If the finding depends on something you could not see (a caller outside the diff, runtime behaviour), say what you assumed.
- **Don't repeat yourself.** On a re-review, skip threads already fixed or answered. When a reply explains why something stays as it is, accept it unless you can show a failure scenario it missed.
- **Keep the summary short.** Give the count of findings by severity and the one or two that matter most. Don't recap the PR.
