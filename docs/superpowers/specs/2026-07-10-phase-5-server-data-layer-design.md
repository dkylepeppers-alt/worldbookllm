# Phase 5 Server Data Layer Design

**Date:** 2026-07-10

**Status:** Approved by the existing Milestone 1 plan; ready for implementation planning

**References:** ADR 0003, ADR 0006, `docs/ARCHITECTURE.md`, and the approved Milestone 1 plan

## Context

Phase 4 completed the model-agnostic provider core. Phase 5 gives the Fastify server its first durable application state: notebooks, pasted Markdown sources, and provider secrets. It establishes the storage and API boundaries that Phase 6 chat generation and the later web phases will consume.

The central constraint is ADR 0003: source Markdown on disk is user-owned truth. SQLite indexes source metadata and owns non-source application state, but source content must never be hidden in the database. The server must read a source file on every source-detail request so edits made outside the application are visible immediately.

## Goals

- Resolve and create one configurable data directory.
- Open SQLite with WAL mode, foreign keys enabled, and ordered `user_version` migrations.
- Create schema v1 for notebooks, sources, chats, and messages without adding M2/M3 features early.
- Store pasted sources as self-describing frontmattered Markdown files.
- Store multiple named provider keys per secret key, select one active key, and never expose raw values through the API.
- Provide validated notebook, source, and secret HTTP APIs.
- Keep storage dependencies injectable so `fastify.inject()` tests use isolated temporary directories.

## Non-goals

- Chat/message CRUD, provider calls, SSE generation, or prompt assembly; those are Phase 6.
- FTS5, categories, tags, uploads, reconciliation scans, or automatic database rebuild; those belong to later milestones.
- Source editing in the API. M1 only pastes, lists, reads, and deletes sources.
- An ORM, general repository framework, background watcher, or multi-process coordination.
- Importing or reading a user's existing SillyTavern secrets file.

## Chosen Architecture

The server uses three explicit layers:

1. **Storage primitives** own SQLite, Markdown files, and the atomic JSON secrets file.
2. **Services** coordinate storage operations and translate rows into shared API types.
3. **Fastify routes** validate request data with shared Zod schemas and translate known service errors into HTTP responses.

This is preferred over route-inline SQL because Phase 6 needs to reuse notebook, source, and secret access outside HTTP handlers. It is preferred over an ORM because schema v1 is small, SQLite-specific pragmas matter, and ADR 0006 explicitly chooses a minimal migration runner.

`buildApp()` accepts an optional `dataDir`. It constructs and decorates the application with a database, source file store, secret store, and services, then closes SQLite through an `onClose` hook. Production gets `DATA_DIR` from `env.ts`; tests pass a temporary directory directly.

## Data Directory and Environment

`env.ts` exposes a resolver rather than global mutable configuration:

- Explicit `dataDir` wins when supplied by tests or embedding callers.
- Otherwise `DATA_DIR` is resolved to an absolute path.
- Otherwise the default is `<repo>/data`, derived from the server module location rather than the process working directory.

Startup creates the directory recursively. The phase uses this layout:

```text
data/
├── worldbookllm.db
├── secrets.json
└── notebooks/
    └── <notebook-id>/
        └── sources/
            └── <source-id>-<slug>.md
```

All stored `file_path` values are POSIX-style paths relative to the data directory. File access resolves the recorded relative path under `dataDir` and rejects paths that escape it.

## SQLite and Migrations

`openDatabase(dataDir)` creates `worldbookllm.db`, enables `journal_mode = WAL` and `foreign_keys = ON`, then runs ordered migrations. Each migration has a numeric version and an `up(db)` function. The runner:

1. Reads `PRAGMA user_version`.
2. Rejects a database version newer than the application knows.
3. Applies each missing migration in its own transaction.
4. Sets `user_version` inside the same transaction.

Migration 001 creates:

- `notebooks(id, name, settings_json, created_at, updated_at)`
- `sources(id, notebook_id, title, slug, file_path, origin, word_count, content_hash, created_at, updated_at)` with `ON DELETE CASCADE`
- `chats(id, notebook_id, title, source_ids_json, provider_override_json, created_at, updated_at)` with `ON DELETE CASCADE`
- `messages(id, chat_id, seq, role, content, reasoning, status, context_json, created_at)` with `ON DELETE CASCADE`, role/status checks, and unique `(chat_id, seq)`

Indexes cover source and chat foreign keys. Timestamps are UTC ISO-8601 strings. IDs use `crypto.randomUUID()`. Notebook settings default to JSON `null`, which represents no selected provider until the UI configures one.

## Shared Schemas

`packages/shared` owns Zod request/response schemas and inferred types:

- Provider config: provider source, model, optional base URL, and provider-specific extras.
- Notebook: list/detail shape plus create and patch bodies.
- Source: metadata/detail shape plus paste body.
- Secret: masked state plus create body and key/id path parameters.

Provider names are duplicated as a Zod enum in shared rather than importing the providers package. This preserves the existing one-way dependency direction: both web and server can consume shared without dragging provider implementation code into the browser. A test pins the enum to the 26 M1 provider names.

Request strings are trimmed and bounded. Unknown properties are rejected. Patch schemas require at least one field. API response schemas are exported so later clients can validate server responses without redefining shapes.

## Markdown Source Files

`SourceFileStore` uses `gray-matter` and synchronous filesystem operations, matching the single-process synchronous SQLite design. A source filename is `<source-id>-<slug>.md`; the ID guarantees collision resistance, while the slug stays readable. Slugs are lowercase ASCII words joined by hyphens, with `source` as the empty fallback.

Frontmatter is deliberately self-describing:

```yaml
id: <uuid>
notebookId: <uuid>
title: Example
origin: paste
createdAt: <ISO timestamp>
updatedAt: <ISO timestamp>
```

The body remains the user's pasted Markdown. Writes use a same-directory temporary file, mode `0600`, then rename for atomic replacement. The store returns word count and a SHA-256 content hash over the body. Reads parse and validate required frontmatter, recalculate body-derived metadata, and return fresh content. This makes external body edits visible and lets the service repair `word_count` and `content_hash` in SQLite on access.

The file store exposes removal of an individual source and a notebook directory. It never accepts an arbitrary absolute path from an HTTP request.

## Cross-Store Consistency

SQLite and the filesystem cannot share a transaction, so services use short compensating workflows:

- **Create source:** verify notebook, write the new file atomically, then insert its row. If insertion fails, remove that newly-created file.
- **Read source:** fetch its row, read the recorded file fresh, and update changed word-count/hash metadata. A missing or invalid file is a specific storage error; the database content is never used as a fallback.
- **Delete source:** remove the database row in a transaction, then remove the file. If file deletion fails, the database transaction is rolled back. The transaction is synchronous, so no other local request observes the intermediate state.
- **Delete notebook:** collect source paths, delete the notebook row in a transaction (cascading source/chat rows), remove the notebook directory, and roll back on filesystem failure.

The final two operations call synchronous filesystem functions while the SQLite transaction is open. That is acceptable for the local single-user process and keeps user data and its index aligned without introducing a journal system. Deleting a missing source file is idempotent, which also allows cleanup of an already-broken index entry.

## Secret Store

The secret format and rotation semantics are fidelity-ported from SillyTavern commit `29e0df488`:

```json
{
  "api_key_openrouter": [{ "id": "...", "value": "...", "label": "Personal", "active": true }]
}
```

Adding a secret deactivates existing entries for the key and activates the new entry. Activating an ID makes it the sole active entry. Deleting an active entry activates the first remaining entry. Secret reads for provider execution can return the raw active value only through a server-internal method.

API state always masks values, including URL-like or short values: values longer than ten characters expose only their final three characters; all others become ten asterisks. Unlike SillyTavern, there is no exposure configuration because the architecture promises keys are always masked.

`secrets.json` and its temporary replacement are mode `0600`. Mutations use write-temp, fsync, rename. The store validates parsed JSON structurally before use and fails closed on corruption rather than overwriting it. Secret keys are non-empty bounded identifiers, not restricted to today's provider catalog, so future provider fields and service-account secrets do not require a storage migration.

## Services and HTTP API

### Notebooks

- `GET /api/notebooks` lists notebooks ordered by most recently updated.
- `POST /api/notebooks` creates `{name, settings?}` and returns `201`.
- `GET /api/notebooks/:id` returns one notebook.
- `PATCH /api/notebooks/:id` updates name and/or provider settings.
- `DELETE /api/notebooks/:id` cascades metadata and deletes its source directory, returning `204`.

### Sources

- `GET /api/notebooks/:id/sources` lists source metadata ordered by creation.
- `POST /api/notebooks/:id/sources` accepts `{title, content}` and returns `201`.
- `GET /api/sources/:id` reads and returns current Markdown content from disk.
- `DELETE /api/sources/:id` deletes file and row, returning `204`.

M1 source origin is always `paste`. Source titles come from validated API input/frontmatter; out-of-band title edits are reflected on detail read and repaired in the row along with content-derived metadata.

### Secrets

- `GET /api/secrets` returns only keys that currently have entries, with masked values.
- `POST /api/secrets` accepts `{key, value, label?}` and returns the newly masked entry with `201`.
- `POST /api/secrets/:key/:id/activate` rotates the active entry.
- `DELETE /api/secrets/:key/:id` removes an entry and returns `204`.

Unknown resources return `404`. Invalid inputs return a stable `400` error body. Unexpected storage failures remain `500` and never include secret content in their messages.

## Testing Strategy

Implementation follows focused red-green cycles:

1. Shared-schema tests pin valid/invalid boundary shapes.
2. Database tests pin pragmas, schema constraints, migration idempotency, and future-version rejection.
3. File-store tests pin layout, frontmatter, hashes, atomic replacement artifacts, external edits, and path safety.
4. Secret-store tests pin masking, add/activate/delete rotation, permissions, corruption handling, and absence of raw values from public state.
5. `fastify.inject()` integration tests exercise notebook/source/secret CRUD, file-plus-row consistency, external edits, cascade deletion, validation, and missing resources in a fresh temporary data directory.

Tests never touch the repository `data/` directory and clean up temporary directories after closing the app.

## Memory-Safe Execution

- No parallel agents or test processes.
- Run one focused Vitest file at a time during red-green cycles.
- Run package typechecks only at subsystem checkpoints.
- Run repository-wide lint, formatting, typecheck, tests, and build sequentially at final review.
- Commit and push each completed subsystem so an environment process kill cannot erase reviewed work.
- Avoid watch processes and keep command output bounded.

## Acceptance Criteria

- Reopening the same data directory preserves notebooks, sources, and secrets, and migrations remain idempotent.
- SQLite reports WAL mode, foreign keys enabled, and `user_version = 1`.
- Source bodies exist only in readable Markdown files; detail reads surface out-of-band file edits.
- Notebook deletion cascades database records and removes its source files.
- No secret API response or public store method contains a raw secret value.
- Rotation and deletion leave at most one active secret per key and select a fallback when needed.
- All route payloads are validated by shared schemas and integration-tested through `fastify.inject()`.
- Focused tests and the final sequential repository gates pass.
