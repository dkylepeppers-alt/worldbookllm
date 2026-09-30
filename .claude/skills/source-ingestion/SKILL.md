---
name: source-ingestion
description: Constraints and workflow for acquiring, converting, reviewing, and importing material into books. Use before changing uploads, PDF or HTML conversion, URL fetching, book imports, or ingestion tests.
---

# Working on ingestion

Ingestion follows the pipeline fixed in `docs/ARCHITECTURE.md`:

`acquire → extract text → convert to Markdown → user review/edit → write into the book (one checkpoint)`

Since ADR 0014 and ADR 0017 there are no notebooks or sources: material is filed into a story-skills book, as research notes by default. Read ADR 0014 decision 5 before changing an import contract; `docs/superpowers/specs/2026-07-14-m2-source-ingestion-contracts.md` still holds the conversion limits and URL-fetch rules. Use the `frontend-developer` skill for the review editor and the `new-adr` skill before selecting PDF/HTML conversion dependencies or locking in URL-fetch policy.

## Hard constraints

- The book's Markdown files are the source of truth. Conversion previews are inspectable Markdown, and nothing is written before the user reviews it. Writes go through `apps/server/src/story/` (confined paths, one checkpoint per import, reindex and validate, undone whole if validation rejects a file).
- The server owns acquisition, conversion, filesystem access, and URL fetches. The browser uses typed `/api` contracts and never fetches source URLs directly.
- Enforce explicit upload, extracted-text, converted-Markdown, response-size, redirect, and processing-time limits. Reject unsupported media instead of guessing from untrusted extensions alone.
- Use isolated temporary files only when a converter requires them. Create them under an operation-specific temporary directory, use restrictive permissions, and remove the directory after success, rejection, cancellation, or failure.
- Keep file and index changes recoverable: write files atomically inside the import's checkpoint so a failure can be undone, and never leave the index pointing at a partial or missing file.
- Record provenance as flat, JSON-quoted frontmatter keys (`origin-type`, `origin-file`/`origin-url`, `imported-at`, `conversion-notes`); nested maps fail `story validate`, and the app adds no `id` key.
- Do not retain uploaded originals. Importing again requires another upload and another review.

## URL acquisition security

- Accept only absolute `http:` and `https:` URLs. Reject credentials in URLs and all other schemes.
- Resolve and validate every destination before connecting. Block loopback, private, link-local, multicast, unspecified, and other non-public IPv4/IPv6 ranges.
- Pin the validated address for the connection so a second DNS answer cannot redirect the request. Apply the same validation and pinning to every redirect target to prevent DNS rebinding and redirect-based SSRF.
- Set strict redirect-count, connect, total-time, header-size, and decoded-body-size limits. Abort the upstream response as soon as a limit is exceeded.
- Accept only supported HTML content types for webpage conversion. Do not trust an extension or a server-provided filename as proof of type.
- Parse fetched bytes as data. Never execute scripts, run active content, load subresources, forward ambient credentials, or expose credential-bearing/error-detail URLs.

## Implementation workflow

1. Keep wire schemas in `packages/shared`; server routes and the web client import them.
2. Separate acquisition and conversion from persistence. A preview operation must not write into the book.
3. Keep format converters behind small server-side interfaces so `.md`, `.txt`, PDF, and HTML behavior can be tested independently.
4. Make every import path use the same book write primitive (`BookService.writeImports`).
5. Use deterministic checked-in fixtures for every supported format. Include malformed, oversized, mislabeled, empty, redirecting, and blocked-address cases.
6. Test services and routes with local fixtures or controlled in-process HTTP servers. Tests and CI must not depend on public websites.
7. Run server/shared/web tests for the touched contracts, then use the `verify` skill for the complete browser journey.
