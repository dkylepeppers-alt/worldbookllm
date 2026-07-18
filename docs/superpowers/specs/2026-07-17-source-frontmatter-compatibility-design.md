# Source Frontmatter Compatibility Design

**Date:** 2026-07-17

## Problem

WorldbookLLM stores each source as Markdown with application-managed YAML frontmatter. Markdown imports are reviewed and passed to the file store as source content, including any frontmatter already present in the imported document.

`gray-matter.stringify(content, managedMetadata)` parses frontmatter from a string input and merges it with the managed metadata. This moves user-authored fields into WorldbookLLM's outer metadata block. The source reader validates that block with a strict schema, so fields such as `subtitle`, `status`, `name`, or `description` make the saved source unreadable. A newly imported source can therefore be written successfully and then fail when the UI navigates to its reader, which presents as a failed save.

## Goals

- Preserve reviewed Markdown content, including user-authored frontmatter, without merging it into application metadata.
- Restore readability for existing source files that already contain extra frontmatter fields.
- Continue validating every required WorldbookLLM identity and provenance field.
- Keep the current file layout, API schemas, SQLite schema, and managed category/tag behavior.

## Non-goals

- Redesigning the source file format or introducing a database migration.
- Treating arbitrary user frontmatter as queryable WorldbookLLM metadata.
- Guessing replacements for missing or malformed required metadata.
- Reclassifying existing source categories or tags.

## Design

### New writes

The file store will pass an object containing the reviewed Markdown as `content` to `gray-matter.stringify`, rather than passing the Markdown as the string input. The managed metadata remains the serializer's data argument.

This produces one outer WorldbookLLM frontmatter block followed by the reviewed Markdown body. If the reviewed body starts with its own `---` block, that block remains part of the body exactly where the user reviewed it. Ordinary content without frontmatter retains its current serialized shape.

### Legacy reads

The reader will distinguish known managed keys from unknown keys in the existing outer frontmatter. It will validate the known keys with the current strict managed schema. Unknown keys will not weaken validation of IDs, notebook ownership, origin, timestamps, category, or tags.

When unknown keys exist, the reader will serialize those keys back into a frontmatter block and prepend it to the returned Markdown body. This recovers the user-authored metadata that older writes merged into the managed block. A subsequent ordinary edit naturally rewrites the file in the corrected nested form.

Known names remain owned by WorldbookLLM. In particular, `tags` continues to mean the managed source tags introduced by the organization feature; it is not duplicated into the recovered body. This is deterministic and avoids creating two conflicting tag values.

### Data flow

1. Import conversion returns the reviewed Markdown unchanged.
2. Source creation validates managed category, tags, provenance, and title.
3. The file store writes managed frontmatter around, rather than merged with, the reviewed content.
4. The reader validates managed fields and restores legacy unknown fields to the visible body.
5. The source service reconciles body-derived hash and word-count metadata as it already does.

No API or database shape changes.

### Error handling

Unknown frontmatter fields are compatible user content and do not cause a read failure. Invalid or missing required managed fields still produce `InvalidStoredDataError`. Unsafe paths and file I/O errors retain their current behavior.

## Compatibility and recovery

The fix is lazy and non-destructive. Existing files are not rewritten at startup. They become readable immediately, and only a user-initiated edit migrates a legacy file to the corrected representation. No source files are deleted, and SQLite remains a rebuildable index of managed metadata.

Some legacy fields used a name now owned by WorldbookLLM, especially `tags`. Those fields remain managed metadata because their original intent cannot be inferred safely. Other extra fields are recovered into the visible Markdown body.

## Testing

File-store regression tests will prove that:

- saving Markdown with its own frontmatter preserves that frontmatter in the returned content and keeps it separate from managed metadata;
- a legacy file whose outer block contains unknown fields is readable and returns those fields in the Markdown body;
- required managed metadata remains strictly validated;
- plain Markdown and managed category/tag round trips remain unchanged.

A service or API regression test will cover the user-visible sequence: create a source whose reviewed content starts with frontmatter, then immediately retrieve it successfully. Existing server tests, type checking, linting, formatting checks, and the relevant web/server suites will be run before completion.
