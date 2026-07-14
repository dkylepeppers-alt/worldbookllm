---
name: new-adr
description: Scaffold a new architecture decision record in docs/decisions/. Use when an architectural decision needs recording — new dependency with lock-in, storage/format change, protocol or licensing choice — per the project convention that architecture decisions get an ADR.
---

# Creating an ADR

Project convention (AGENTS.md): architecture decisions get an ADR in `docs/decisions/`.

## Steps

1. Find the next number: `ls docs/decisions/` — files are `NNNN-kebab-case-title.md` with a zero-padded four-digit prefix (e.g. `0006-better-sqlite3.md`). Use the next integer.
2. Create `docs/decisions/NNNN-short-kebab-title.md` following the house format below.
3. If the ADR changes how contributors work (new command, new constraint), also update `AGENTS.md` and, when relevant, `docs/ARCHITECTURE.md`.

## Format

Match the existing files (read one, e.g. `docs/decisions/0005-sillytavern-provider-port-agpl.md`, before writing):

```markdown
# ADR NNNN — Imperative title of the decision

**Status:** accepted · YYYY-MM-DD

## Context

What forces are at play; the problem this decision resolves. Reference the
roadmap milestone or prior ADRs it relates to.

## Decision

Numbered, concrete statements of what was decided.

## Rationale

Why this option over the alternatives actually considered.

## Consequences

What becomes easier, what becomes harder, what is now locked in.
```

Notes:

- Status line may carry qualifiers like `supersedes …` when replacing an earlier decision; if superseding, also edit the old ADR's status.
- Keep it short — the existing ADRs are under a page. Decisions, not documentation.
- Write in the same declarative voice as the existing records; prose, not bullet fragments, in Context/Rationale.
