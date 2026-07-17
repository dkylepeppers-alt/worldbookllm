# ADR 0012 — FTS5 standalone search index synchronized by services

**Status:** accepted · 2026-07-17

## Context

M3 promises full-text search across a notebook, and ADR 0003 already reserved SQLite for "the FTS5 search index" — but source content lives only in Markdown files on disk, never in a SQLite column. That rules out FTS5's external-content mode (nothing to reference), and a contentless table cannot produce `snippet()` excerpts, which are the point of "find every mention of a faction in seconds". Trigger-based sync is likewise impossible: there is no content column for a trigger to observe.

## Decision

1. `source_search` is a **standalone FTS5 table** storing its own copy of each source's title and content, with `source_id`/`notebook_id` as UNINDEXED columns and the `unicode61 remove_diacritics 2` tokenizer (no porter stemming, no prefix indexes).
2. **Services keep it in sync explicitly**, inside the same `db.transaction` as the row writes: source create, patch, delete, on-read reconciliation of out-of-band file edits, and notebook delete (FK cascade does not reach FTS shadow tables).
3. **Startup backfill/self-heal:** migration 006 creates the table empty; `SourceService.ensureSearchIndex()` runs at app construction and reads every source's Markdown file — rows whose file drifted while the app was closed are reconciled (metadata row and FTS entry refreshed, same as the on-read path), rows missing from the table are indexed, and unreadable files are logged and skipped.
4. User input never reaches `MATCH` raw: every whitespace token is emitted as a quoted prefix phrase (`"token"*`, embedded quotes doubled). Ranking is `bm25` with title weighted 5×; excerpts come from `snippet()` as plain text.

## Rationale

Duplicating content into the FTS table is the only design that yields ranked, excerpted search while files stay the source of truth — the whole database, FTS included, remains a rebuildable index per ADR 0003, and `ensureSearchIndex` makes that rebuild real (it also upgrades pre-M3 data dirs for free). Explicit service writes match how every other index write in the codebase already works, keep FTS updates atomic with row updates, and avoid trigger magic that could not work here anyway. Quoted prefix phrases make hostile query syntax inert while giving find-as-you-type behavior; stemming was rejected because worldbuilding text is proper-noun-heavy and precision matters more than recall.

## Consequences

- Every future write path that touches source content must also update `source_search`; the startup self-heal catches omissions but only at the next boot.
- Content is stored twice (file + FTS shadow tables), and startup reads every source file to reconcile; both acceptable at the hundreds-of-sources scale M3 targets.
- Deletes address FTS rows via a `WHERE source_id = ?` scan of an UNINDEXED column; fine at this scale, revisit (with `prefix=` indexes) only if notebooks grow far beyond the roadmap's 100-source bar.
