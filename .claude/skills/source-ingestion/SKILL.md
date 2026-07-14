---
name: source-ingestion
description: Constraints and workflow for M2 source acquisition, conversion, review, provenance, editing, and re-ingestion. Use before changing source upload, PDF or HTML conversion, URL fetching, source persistence, or ingestion tests.
---

# Working on source ingestion

M2 follows the pipeline fixed in `docs/ARCHITECTURE.md`:

`acquire → extract text → convert to Markdown → user review/edit → store`

Read `docs/superpowers/specs/2026-07-14-m2-source-ingestion-contracts.md` before changing an ingestion contract. Use the `frontend-developer` skill for the review editor and the `new-adr` skill before selecting PDF/HTML conversion dependencies or locking in URL-fetch policy.

## Hard constraints

- Markdown files under `data/notebooks/<notebook-id>/sources/` remain the source of truth. Conversion previews are inspectable Markdown, and nothing is saved before the user reviews it.
- The server owns acquisition, conversion, filesystem access, and URL fetches. The browser uses typed `/api` contracts and never fetches source URLs directly.
- Enforce explicit upload, extracted-text, converted-Markdown, response-size, redirect, and processing-time limits. Reject unsupported media instead of guessing from untrusted extensions alone.
- Use isolated temporary files only when a converter requires them. Create them under an operation-specific temporary directory, use restrictive permissions, and remove the directory after success, rejection, cancellation, or failure.
- Keep source-file and SQLite changes recoverable. Write source files atomically and compensate for database failures; never leave a database row pointing at a partial or missing file.
- Record structured origin metadata and human-readable conversion notes. Preserve source identity and `createdAt` when editing or re-ingesting; update the content hash, word count, provenance, and `updatedAt`.
- Do not retain uploaded originals in M2. Re-ingesting a local file requires another upload; re-ingesting a URL performs a new guarded fetch and still requires review.

## URL acquisition security

- Accept only absolute `http:` and `https:` URLs. Reject credentials in URLs and all other schemes.
- Resolve and validate every destination before connecting. Block loopback, private, link-local, multicast, unspecified, and other non-public IPv4/IPv6 ranges.
- Pin the validated address for the connection so a second DNS answer cannot redirect the request. Apply the same validation and pinning to every redirect target to prevent DNS rebinding and redirect-based SSRF.
- Set strict redirect-count, connect, total-time, header-size, and decoded-body-size limits. Abort the upstream response as soon as a limit is exceeded.
- Accept only supported HTML content types for webpage conversion. Do not trust an extension or a server-provided filename as proof of type.
- Parse fetched bytes as data. Never execute scripts, run active content, load subresources, forward ambient credentials, or expose credential-bearing/error-detail URLs.

## Implementation workflow

1. Keep wire schemas in `packages/shared`; server routes and the web client import them.
2. Separate acquisition and conversion from persistence. A preview operation must not create a source row or permanent source file.
3. Keep format converters behind small server-side interfaces so `.md`, `.txt`, PDF, and HTML behavior can be tested independently.
4. Make edit and re-ingest paths use the same atomic source persistence primitive as initial save.
5. Use deterministic checked-in fixtures for every supported format. Include malformed, oversized, mislabeled, empty, redirecting, and blocked-address cases.
6. Test services and routes with local fixtures or controlled in-process HTTP servers. Tests and CI must not depend on public websites.
7. Run server/shared/web tests for the touched contracts, then use the `verify` skill for the complete browser journey.
