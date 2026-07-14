# ADR 0008 — PDF and HTML conversion dependencies

**Status:** accepted · 2026-07-14

## Context

M2 expands source ingestion beyond pasted text and SillyTavern JSON to Markdown, plain text, PDF, and HTML uploads, each converted to inspectable Markdown before review. The M2 contract (`docs/superpowers/specs/2026-07-14-m2-source-ingestion-contracts.md`) requires that dependency selection for PDF extraction, HTML parsing/readability, and Markdown conversion be recorded in an ADR before implementation, and that converters prefer maintained libraries with deterministic output and no external service.

Converters run entirely server-side behind small interfaces (`apps/server/src/services/converters/`) with no browser or database dependency, so the libraries must run in a plain Node process without a headless browser, worker threads, or canvas.

## Decision

1. **PDF text extraction — `unpdf`.** It bundles a serverless build of pdf.js and exposes a single `extractText()` call with no worker, canvas, or DOM setup. We extract text only (no OCR, no image or layout reconstruction) and report the loss in conversion notes.
2. **HTML parsing — `linkedom`.** A lightweight, standards-shaped DOM sufficient to feed Readability, without the weight of a full browser emulation.
3. **HTML main-content extraction — `@mozilla/readability`.** The Firefox Reader Mode engine; deterministic, and when it cannot isolate an article we fall back to the full document `<body>` with a conversion note.
4. **HTML → Markdown — `turndown` with `@joplin/turndown-plugin-gfm`.** Turndown is the maintained HTML-to-Markdown converter; the Joplin GFM plugin (a maintained fork of the dormant upstream `turndown-plugin-gfm`) adds table and strikethrough support.
5. **Rejected `pdfjs-dist` directly** — `unpdf` wraps it and removes the worker/canvas configuration churn. **Rejected `happy-dom`** — full browser emulation is heavier than parsing needs.
6. **Centralized limits.** Uploads are bounded at 25 MiB (multipart), converted Markdown at 10 MiB (matching the existing `createSourceSchema` content cap), and previews at 1000 entries. These live in one module (`converters/limits.ts`) and produce stable `invalid_import` errors.

## Rationale

Every selected library runs in-process, is MIT/ISC/Apache-2.0 licensed (compatible with the project's AGPL-3.0), performs no network I/O, and produces deterministic output for a given input — which keeps conversion testable with checked-in fixtures and CI free of external websites. Wrapping pdf.js via `unpdf` and DOM parsing via `linkedom` avoids the two heaviest configuration burdens (pdf.js workers, browser emulation) while keeping the conversion surface small.

## Consequences

- PDF conversion is text-only: multi-column layout, images, and table structure degrade to plain text, and each PDF preview carries a warning note. Scanned/image-only PDFs yield no text and are rejected (no OCR in M2).
- Readability may drop peripheral page content; the HTML converter records when it fell back to the full body.
- All conversion is in-memory, bounded by the 25 MiB upload limit, so M2 needs no operation-scoped temporary files. A future format that cannot be safely buffered would revisit this behind the same route boundary.
