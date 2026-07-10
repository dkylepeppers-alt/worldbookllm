# ADR 0006 — better-sqlite3 for the index database

**Status:** accepted · 2026-07-10

## Context

ADR 0003 chose SQLite for metadata, search, and chat history. A driver is needed. Candidates: `better-sqlite3` (synchronous, native prebuilds), the experimental `node:sqlite` built-in, and async wrappers (`sqlite3`).

## Decision

Use **better-sqlite3** with WAL mode, foreign keys ON, and a minimal `PRAGMA user_version`-based migration runner (ordered migrations applied in transactions at boot).

## Rationale

- Synchronous API fits a local-first, single-process server: no connection pooling, no async ceremony around microsecond queries, dramatically simpler service code.
- Mature, fast, ships prebuilt binaries for Linux/macOS/Windows on Node 20 — no compiler needed for `pnpm install` in CI or on user machines.
- `node:sqlite` is still maturing on Node 20 and lacks the ecosystem track record.
- A hand-rolled migration runner (a dozen lines) beats adding an ORM/migration framework at this scale; FTS5 and later schema changes are just numbered migrations.

## Consequences

- Native module: version is pinned; if a future Node major lags prebuilds, CI needs build tools (acceptable, rare).
- Queries block the event loop — fine for local single-user use; revisit only if a hosted multi-user variant ever appears.
