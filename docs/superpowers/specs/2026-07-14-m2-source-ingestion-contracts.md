# M2 Source Ingestion Contracts

**Date:** 2026-07-14

**Status:** Contract baseline for M2 implementation

**Baseline:** Verified M1 walking skeleton

## Goal and boundaries

M2 accepts Markdown, text, PDF, and webpage sources, converts them to inspectable Markdown, requires review before persistence, and supports later editing, deletion, and re-ingestion. It does not add categories, tags, FTS, retained original binaries, background jobs, OCR, or general-purpose web crawling.

All formats follow one boundary:

`acquire → extract text → convert to Markdown → user review/edit → store`

Acquisition and conversion are server responsibilities. A successful conversion returns a transient preview and creates no permanent file or SQLite row. The browser owns only the editable preview state. Saving uses the existing source persistence boundary after the user confirms the Markdown.

## Shared contracts

`packages/shared` owns the request and response schemas. The stable conceptual shapes are:

```ts
type SourceOrigin =
  | { type: 'paste' }
  | { type: 'file'; fileName: string; mediaType: string }
  | { type: 'url'; url: string; fetchedAt: string; mediaType: string };

interface SourcePreview {
  title: string;
  markdown: string;
  origin: SourceOrigin;
  conversionNotes: string[];
}
```

Stored source metadata gains `origin` and `conversionNotes`. The same structured origin is written to source frontmatter so a file remains self-describing without SQLite. User-edited Markdown is stored exactly as reviewed; conversion notes describe converter behavior and warnings, not hidden source content.

## HTTP contracts

### Preview a local file

`POST /api/notebooks/:id/source-previews/file` accepts one multipart file. Supported inputs are `.md`, `.txt`, and PDF. The server validates notebook ownership, declared media type, detected format, and configured limits before returning `SourcePreview`.

Markdown is decoded and returned without semantic rewriting. Plain text receives minimal deterministic Markdown normalization. PDF extraction and Markdown conversion are best effort and report warnings such as omitted images or uncertain table structure.

### Preview a webpage

`POST /api/notebooks/:id/source-previews/url` accepts `{ url }`. The server performs a guarded fetch and returns a `SourcePreview` only for supported HTML responses. It extracts the primary document content where practical, converts it to Markdown, records the final public URL after redirects, and reports removals or ambiguities in conversion notes.

### Save a reviewed preview

`POST /api/notebooks/:id/sources` continues to create a source and accepts reviewed `title`, `content`, structured `origin`, and `conversionNotes`. Paste creation supplies `{ type: 'paste' }` and an empty notes list. Preview responses are not trusted capabilities: save validates the complete payload again.

### Edit or replace a source

`PATCH /api/sources/:id` accepts reviewed `title` and/or `content`. Ordinary edits preserve origin and conversion notes. A reviewed re-ingestion supplies a complete replacement of `title`, `content`, `origin`, and `conversionNotes`; it preserves source ID and `createdAt` while updating filename slug if needed, hash, word count, and `updatedAt`.

Re-ingesting a file requires a new upload because M2 does not retain original binaries. Re-ingesting a URL runs the URL preview flow again. Both return to review before replacement. `DELETE /api/sources/:id` remains the permanent delete operation.

## UI state contract

The source workflow has explicit `choose → converting → review → saving → saved` states plus recoverable conversion and save errors. Navigation away from a modified review asks for confirmation. The review screen shows:

- editable title and Markdown;
- origin filename or URL;
- conversion notes and warnings;
- cancel and save/replace actions;
- no implication that a preview has already entered the notebook.

Source viewing gains edit and re-ingest actions. Re-ingest starts a new preview and does not change the saved source until replacement succeeds. Failed or cancelled conversion leaves the existing source unchanged.

## Persistence and failure semantics

- Permanent source content remains a frontmattered Markdown file; SQLite remains a rebuildable index.
- Source writes use a same-directory temporary file, flush, atomic rename, and restrictive permissions.
- Create compensates for a failed database insert by removing the new file.
- Edit/re-ingest keeps the previous file recoverable until the database update succeeds; failure restores the prior file and metadata.
- A title change may change the slugged path. The operation must not leave duplicate source files or a row pointing to the old path.
- Converter temporary files are operation-scoped and removed on success, error, timeout, abort, or process-level request cancellation.
- Limits are centralized server configuration and produce stable client-safe errors. Exact defaults are selected with converter dependencies and recorded in the M2 ADR.

## URL security contract

Only absolute HTTP(S) URLs without embedded credentials are accepted. Before each connection, including every redirect, the server resolves the hostname, rejects non-public IPv4 and IPv6 destinations, and pins a validated address for that connection. This blocks loopback, private, link-local, multicast, unspecified, IPv4-mapped private IPv6, redirect-based SSRF, and DNS-rebinding changes between validation and connection.

Fetches have strict redirect, connection-time, total-time, header-size, and decoded-body-size limits. Only supported HTML content types are converted. The fetch sends no application secrets or ambient credentials, executes no active content, loads no subresources, and returns sanitized errors that do not disclose sensitive URL components or network details.

## Converter and dependency boundary

Format acquisition and conversion live behind server-side interfaces with no browser or database dependency. Dependency selection for multipart handling, PDF extraction, readability/HTML parsing, Markdown conversion, and address-pinned HTTP must be recorded in an ADR before implementation. Prefer maintained libraries with deterministic output and no external service.

## Verification contract

Checked-in fixtures cover representative Markdown, UTF-8 text, PDF text and tables, and HTML articles and tables. Malformed, empty, oversized, mislabeled, unsupported, timeout, redirect-loop, blocked-address, and DNS-rebinding cases are also covered. Tests use controlled local inputs and in-process HTTP servers; CI never fetches public webpages.

The M2 end-to-end journey uploads a PDF setting bible, previews and fixes converted Markdown, saves it, imports an HTML webpage by URL, edits a saved source, deletes and re-ingests a source, verifies provenance and Markdown on disk, and chats with the resulting sources. The repository lint, format, typecheck, test, and build gate remains mandatory.

