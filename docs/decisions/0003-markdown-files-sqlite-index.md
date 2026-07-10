# ADR 0003 — Markdown files on disk + SQLite index

**Status:** accepted · 2026-07-10

## Context

The product spec's core principle: sources must remain visible and manageable by the user, not hidden inside an opaque AI context system. Storage candidates: everything in SQLite, everything in plain files, or a hybrid.

## Decision

**Hybrid:** each source is a plain `.md` file on disk (with YAML frontmatter); SQLite stores metadata, the FTS5 search index, chat history, and app settings.

## Rationale

- Plain Markdown files deliver the spec's transparency promise directly: users can read, grep, edit, back up, and git-version their sources with any tool they like.
- SQLite handles what files do badly: fast metadata queries, full-text search at scale, and chat history — without inventing a bespoke index format.
- The files are the source of truth for content; the database is derived and can be rebuilt from the files if lost.

## Consequences

- The app must tolerate out-of-band file edits (reconcile on access) — a feature, not a bug, for this audience.
- Two storage layers to keep consistent; mitigated by treating files as truth and the DB as index.
- `data/` is gitignored; it belongs to the user, not the repo.
