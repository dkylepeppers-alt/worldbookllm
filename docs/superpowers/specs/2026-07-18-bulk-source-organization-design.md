# Bulk Organization of Existing Sources Design

## Summary

Extend automatic source organization (2026-07-17 design, where reclassifying existing sources was an explicit non-goal) to sources already saved in a notebook. The source browser gains an Organize dialog: pick sources, request one batched classification from the notebook's configured model, review and edit every suggestion, and apply the accepted values through the existing source PATCH boundary.

This reuses the existing classification service, prompt, parser, category taxonomy, tag rules, and warning copy. It adds no background jobs, no persistence of suggestions, and no automatic writes.

## Goals

- Classify and tag many saved sources in one reviewed pass, with unorganized sources preselected.
- Keep the model's output subordinate to the user's saved organization: a blank suggested category keeps the saved one, and suggested tags extend the saved list instead of replacing it.
- Keep content on the server: the browser sends source ids, never source bodies.
- Fail soft per source — an unreadable file or provider failure yields blank, manually editable fields.

## Non-goals

- Automatic application without review.
- Scheduled or recurring reclassification.
- Raising the single-pass budget beyond the existing 100-draft / 500k-character prompt bounds.

## API

`POST /api/notebooks/:id/source-organization-suggestions/existing` accepts `{ "sourceIds": [...] }` (1–100 unique UUIDs, all belonging to the notebook; an unknown id is a 404). The response mirrors the draft endpoint but is keyed by id: `{ "suggestions": [{ "sourceId", "category", "tags" }], "warning" }`. Classification failures still return `200` with blank suggestions and the standard warning.

## Server

`SourceOrganizationService.suggestForSources` validates membership against the notebook's source index, reads each source through the reconciling `SourceService.get`, excerpts content to 5,000 characters (100 excerpts fit the existing 500k cumulative bound), and delegates to the existing `suggest` path — same prompt, provider controls, parsing, and tag reconciliation. Sources whose files cannot be read are logged, skipped in the prompt, and returned blank with the standard warning; if nothing is readable, no provider call is made.

## Client

The Organize button appears in the source browser whenever sources exist. The dialog is two steps: a checkbox selection (unorganized sources preselected, select all/none, hard cap of 100 per pass) and a review step reusing `SourceOrganizationFields` per source. Suggestions arrive through the same request-lifecycle hook as draft classification (single attempt, abort on close, stale results discarded, per-row `Suggest again` that only overwrites untouched rows).

Apply issues one `PATCH /api/sources/:id` per changed row — rows whose reviewed values match the saved metadata are skipped — and updates the workspace source index as each save lands. Failures are reported by title and leave the dialog open; because applied rows now match the workspace, retrying Apply only re-sends the failures.

## Testing

Shared schema tests for the new contracts; server tests for membership, excerpting, id remapping, unreadable-source degradation, and the route (including 404/400 bounds); web tests for preselection, suggestion merge semantics, unchanged-row skipping, fallback warning, and save-failure retention; and a bulk step in the deterministic `organization.spec.ts` browser journey, including frontmatter persistence on disk.
