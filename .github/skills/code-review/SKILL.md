---
name: code-review
description: How to review a pull request in worldbookllm. Use for every code review in this repository. It sets the bar a finding must clear, how to triage a large diff by risk, the invariants that matter here (book files as the source of truth, checkpoints, the story CLI boundary, ink, discovery, the agent, providers, security, migrations, the shared API contract, the web design system), the bug patterns earlier reviews found, what is intentional and not a finding, and the exact format for findings.
---

# Reviewing a worldbookllm pull request

Your job is to find what would hurt the writer or the codebase after merge: lost or corrupted book content, broken undo, leaked keys, wrong behaviour on a path someone will take, and invariants quietly broken. CI already runs `pnpm lint`, `format:check`, `knip`, `typecheck`, `test`, `dedupe --check`, a Docker build, and the Playwright journeys. Anything those catch is not worth a comment.

**A finding must clear this bar:**

- You can name a concrete input or state, the steps, and the wrong result.
- You checked the code that makes it happen, including callers outside the diff.
- The fix is worth its cost.

Five findings that clear it beat twenty that do not. If nothing clears it, say the PR looks sound and name what you checked.

## How to review

1. **Read the contract first.** Read `AGENTS.md`, the PR description, and every ADR in `docs/decisions/` that the diff touches or names. An ADR's numbered decisions are the spec. Code that contradicts one is a finding, unless the PR also updates the ADR.
2. **Triage by risk.** On a large diff, spend your time in this order:
   1. code that writes book files, the database, or secrets;
   2. concurrency: locks, queues, background jobs, polling;
   3. parsing of user or model text (frontmatter, ink, JSON from a model);
   4. API routes and the shared schemas between client and server;
   5. UI state and effects;
   6. everything else.

   Read the tests for each area after its code, not before.

3. **Follow every changed function to its callers.** Check what callers do with its return value and its errors. Many bugs are a correct function used wrongly.
4. **Walk the states.** For anything with modes, queues, or lifecycles, list the states and the transitions between them. Ask what happens to work in flight at each transition, on failure halfway through, and on restart.
5. **Check every path, not one.** When a rule must hold (a validation, a review pass, a permission, a checkpoint), find every path that writes the same thing and confirm each one applies it.
6. **Check the tests prove the behaviour.** For each new behaviour, would a test fail without the code? Note a missing test only when the untested path is risky.
7. **Write findings** in the format at the end.

## Invariants

### Book files are the source of truth (ADR 0003, ADR 0014)

- **Files, not the database, hold content.** Books are Markdown on disk; SQLite is a rebuildable index and holds conveniences (reads, pending proposals), never content. Flag state that only memory or SQLite holds when the writer would expect to see it in a file. Flag any feature that hides the writer's content from them.
- **One place touches book files.** Only `apps/server/src/story/` reads or writes book files for their meaning, and only `StoryCli` spawns the pinned `story` CLI. Flag `fs` writes to book paths, or `story` spawns, anywhere else.
- **Every write is a checkpoint** (`checkpoints.record`, a `CheckpointSession`, or `BookService.writeDiscover`), so it can be undone.
- **Writes check what they read.** A write based on an earlier read must compare an expected hash (`expectedHash`, an `expected` map, a `file_changed` conflict). Read, then await (a model call, a CLI run), then write without a check is a lost update.
- **Entity changes reindex.** A failed reindex restores the snapshot. Registries (`_index.md`) and `dist/` are never written directly (`assertWritablePath`).
- **App frontmatter** is flat: top-level scalars only, since nested maps fail `story validate`. String values are JSON-quoted (`discover: "seed"`). Numbers and booleans stay typed scalars (`lookahead: 1`, `interactive: true`); quoting them turns them into strings.

### Interactive books in ink (ADR 0030–0033)

- Knot names come from `inkKnotName`; flag hand-built ones.
- Text written into ink is escaped with `inkText` or `inkLine`. Unescaped user or model text containing `{ } | # [ ] ~ ->` or `//` corrupts the story.
- Ink changes compile before they are written, and a change that adds compile errors is refused (`setChapterEnding`, `writeDiscover`).
- Code that rewrites an ending respects `readEnding(...).editable` and keeps the planning above `## Chapter Text`.
- **Discovery (ADR 0033):**
  - Whether a beat is a seed, edited, or stale is derived from the files by `discoverBeats` (frontmatter plus seed ink plus hashes). Code that decides from frontmatter alone will disagree with it.
  - Every path where the beat writer writes choices passes `checkBeat` / `checkChoices` and the review pass. Choices the writer saves themselves (the choices form, `setChapterEnding`) are compiled but deliberately get no model review.
  - Lead mode writes only while the setup says `lead`, and its background work stays bounded by the look-ahead.

### The agent and the beat writer (ADR 0015, ADR 0016, ADR 0033)

- **Tool results are capped and errors go back to the model.** Results go through `truncateResult`. In the chat agent, every tool error returns to the model as a result (`AgentToolRegistry.execute`), because the model can often correct it, for example by reading the right path after a `NotFoundError`. The beat writer's loop is the exception: there, a `ConflictError` or `NotFoundError` means the book changed under the job, so it stops the run. Flag a loop that retries an error which invalidates the whole run, and a loop that aborts on one the model could fix.
- **Changes survive failure.** A turn's checkpoint commits even when the turn fails or is stopped. In review mode, writes go to the staged copy only.
- **Every model loop is bounded:** step limits, review rounds, a dedupe of queued jobs.

### Security

- **Paths:** every path from a request or a model goes through `confine` (book files, `story/book-paths.ts`) or `SkillFileStore`'s `resolveRelative` (skills), which throw `UnsafePathError`. Flag joins of user input onto a root without it.
- **HTML:** rendered Markdown uses `react-markdown` with `skipHtml`; flag `dangerouslySetInnerHTML` and raw HTML rendering. The exported web player inlines the story through `scriptJson` / `scriptText` / `escapeHtml`; any new value inlined there needs the same treatment.
- **Secrets:** API keys live in `SecretStore` and leave the server only masked. Recorded request bodies pass through `snapshotRequestBody`, which redacts them. Flag new logging or storage of requests, keys, or provider error bodies without redaction.
- **Untrusted input:** uploads are capped (`UPLOAD_LIMIT_BYTES`, 25 MiB) and parsed defensively. Model output is untrusted input too: parse it with a schema, never `eval` it, and never use it as a path or a command without validation.

### Providers (`packages/providers`, ADR 0005)

This is ported from SillyTavern under the AGPL. Apply the `providers-port` skill's constraints: request shapes match upstream, and the package does no network I/O or key handling of its own.

### Server, data, and API contract

- **Imports:** ESM with NodeNext, so relative imports end in `.js`.
- **Schemas:** request bodies and parameters are parsed with `z.strictObject` schemas. Schemas the client also uses (response shapes, request bodies it sends) live in `@worldbookllm/shared`; route-local parameter and small body schemas may stay in the route file (`routes/discover.ts`). A field added to a response schema must be filled by the server and by `apps/web/src/test/createTestClient.ts` fixtures. A strict request schema rejects unknown keys, so client and server change together.
- **Status codes:** errors map in `routes/helpers.ts` (`ValidationError` 400, `NotFoundError` 404, `ConflictError` 409). A plain `Error` becomes a 500, so expected failures need the right class.
- **Locks:** book operations run under the book's `KeyedMutex`. Look for slow awaits (model calls) inside the lock, and for read-then-write that drops the lock between the two without re-checking.
- **Migrations** (`apps/server/src/db/migrations/`):
  - append-only, one numbered file per version, never edited after merge;
  - registered in `database.ts`, with the version and table expectations in `database.test.ts` updated;
  - data a migration adds must be safe to lose, or the ADR must say why it is not.

### Web (`apps/web`, read `PRODUCT.md` and `DESIGN.md`)

- **Design system:**
  - tokens only, no hard-coded colours;
  - one indigo accent, with red and green for status only;
  - controls at least 44px;
  - the writer's own words set in the prose serif;
  - no uppercase labels.
- **Every new screen** works at phone width, in light and dark mode, and by keyboard: labelled inputs, visible focus, and `aria-live` for status that changes on its own.
- **React hooks:**
  - effect dependencies are complete and stable;
  - flag a missing dependency, a `setState` in an effect, or an object or function rebuilt every render in a dependency list only when you can show the failure: a stale value, an effect that never re-runs when it must, or a loop of renders or requests. A suppression with a comment explaining a one-time setup (as in `InkEditor.tsx`) is deliberate;
  - polling and requests clean up on unmount (`AbortController`, `clearInterval`).
- **Server agreement:** the UI never offers an action the server is certain to refuse in that state, and it shows the server's error message when a request fails.

### Tests and docs

- **Server tests** drive the API with `fastify.inject()`, scripting the model through `fetchImpl` (see `agent-api.test.ts`, `discover-api.test.ts`).
- **Model-driven journeys:** a new model-driven journey needs a script in the e2e stub provider (`apps/e2e/stub-provider/`).
- **Test reliability:** tests wait on a condition, never a fixed sleep, and stay well under Vitest's 5-second default. A test that takes 3 seconds alone will time out under a full parallel run.
- **Docs:** a change to what the product does updates `docs/ROADMAP.md` and `docs/ARCHITECTURE.md`. A new UI pattern updates `apps/web/DESIGN.md`. A decision with lock-in (a format, storage, dependency, or protocol) needs an ADR.

## Bug patterns found here before

When a diff has one of these shapes, check it closely:

- **Transitions with work in flight.** A setting changes (lead to co-write, review mode on or off) while work is queued under the old one, so it keeps running.
- **Ignored failure results.** A function reports failure in its return value (`{ done: false, problems }`, `null`, an exit code), and a caller does not read it and reports success.
- **Regex parsing that ignores quotes or escapes,** such as a `"https://…"` value cut off at `//`.
- **Two answers to one question.** One place decides from a field, another from the content, and they disagree.
- **A rule on some paths only:** three of the four ways to write a thing are validated.
- **The oldest entry where the newest is wanted.** `find` where `findLast` is needed, so a retry stays hidden behind the failure before it.
- **Reused or remounted components.** A route change keeps the component, so effects keyed only on the position do not fire for the new book. Or pending work is held in a component that remounts while data reloads, and the work is lost.
- **Unbounded background spending:** model calls with no cap, dedupe, or cancellation.

## Not findings here

These are deliberate. Do not flag them unless the PR changes their premise:

- Frontmatter keys added by the app (`origin-type`, `discover-*`), and JSON-quoted string scalars in YAML.
- Polling discovery state every 1.5 seconds instead of streaming it. Agent turns stream over SSE; discovery deliberately does not.
- Discovery jobs held in memory and lost on restart (stated in ADR 0033; lead mode replans).
- The vendored story-skills command table and `story-skills-markdown.ts` (kept in sync with upstream by a test).
- Plain-language UI copy and sentence-case labels, which are the house style.
- Anything Prettier, ESLint, knip, or TypeScript would already reject.

## Calibration

A finding worth posting:

> **High · `apps/server/src/agent/discover/discover-service.ts:480`** — `acceptDraft` ignores `commitBeat`'s `{ done: false }`.
> **Scenario:** the writer removes a variable from `ink/variables.md`, then picks a draft whose choice sets it. The commit fails to compile and returns `done: false`. The draft is removed and the API returns 200, but no chapter is written, and the writer sees their drafts disappear with nothing saved.
> **Fix:** when `!outcome.done`, throw `ValidationError` with the problems, and keep the job.

A finding not worth posting: "Consider extracting this into a helper for readability." It has no failure scenario, and it is a preference.

## Format

Start with one line giving the counts by severity, and name the one or two findings that matter most. Then list the findings, most severe first, one per root cause. When the same mistake is in several places, list them in one finding.

Each finding:

- **Severity · `path:line`** — what is wrong, in one sentence.
- **Scenario:** the input or state, the steps, and the wrong result.
- **Fix:** the change, with a short patch when it is small.
- **Confidence:** only when it is not high. Say what you could not see (a caller outside the diff, runtime behaviour) and what you assumed.

Severity:

- **High:** lost or corrupted book content; a write outside a checkpoint; a lost update; a security issue or leaked secret; a broken invariant above.
- **Medium:** wrong behaviour on a realistic path; a rule missing on one path of several; a request or effect loop.
- **Low:** an edge case, an unclear error, a small accessibility or UX gap.

On a re-review, comment only on new code or on threads still open. When a reply explains why something stays as it is, accept it unless you can show a scenario the reply misses.
