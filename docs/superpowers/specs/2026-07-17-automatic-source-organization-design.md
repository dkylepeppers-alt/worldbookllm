# Automatic Source Organization Design

## Summary

Automatically suggest a category and tags for every newly created source, using the notebook's configured model. Suggestions appear during the existing review flow and remain fully editable before the source is saved. Classification failure never blocks source creation.

This is a thin extension of M3 knowledge-base organization. It uses the existing category taxonomy, free-form tag model, provider configuration, source creation APIs, and Markdown-frontmatter persistence. It does not introduce a second metadata system, background jobs, embeddings, or an autonomous agent.

## Goals

- Suggest one existing source category and three to five concise tags for uploaded files, pasted Markdown, and assistant responses captured as sources.
- Run suggestions automatically as part of each new-source review flow.
- Let the user edit or clear every suggestion before saving.
- Prefer the notebook's established tag vocabulary while allowing genuinely useful new tags.
- Remain provider- and model-agnostic by using the notebook's existing provider configuration.
- Keep source creation usable when no provider is configured or classification fails.
- Preserve Markdown files as the source of truth for accepted categories and tags.

## Non-goals

- Reclassifying or bulk-organizing existing sources.
- Persisting confidence scores, classification prompts, model responses, or an indication that a field was AI-generated.
- Adding notebook-specific category taxonomies; the existing ten canonical categories remain authoritative.
- Adding a background-job system, automatic retries, or periodic reclassification.
- Automatically changing metadata after a source has been saved or edited.
- Adding a notebook setting or global switch for this first version.

## User Experience

### Shared organization controls

All three creation flows use one reusable organization editor containing:

- a category select derived from `SOURCE_CATEGORIES`, with `None` available;
- a comma-separated tags input using the same rules and copy as the saved-source editor;
- a compact loading state while suggestions are being generated;
- a `Suggest again` secondary action after the first attempt; and
- a restrained warning when suggestions are unavailable.

The controls are never read-only. A user can replace, add, or clear suggestions before saving. No confidence score or AI badge is shown because the model output has no authority beyond pre-filling ordinary editable fields.

### Uploaded files

After file conversion produces the existing editable preview, the UI automatically requests organization suggestions for the full preview batch. Each preview entry displays its own category and tags controls beside its title and Markdown fields.

The Markdown review remains visible while classification runs. Saving is allowed after the classification attempt has completed, whether it succeeded or failed. The final batch-create request includes each entry's chosen `category` and `tags`.

One suggestion request covers the batch so a multi-entry lorebook or character-card import does not create one provider round trip per entry. The server applies explicit request limits described below.

### Pasted Markdown

The paste dialog becomes a two-step flow:

1. The user enters a title and Markdown content and chooses `Continue`.
2. The dialog automatically requests a suggestion, then shows the editable organization controls in a review step with the title and Markdown still editable.

The final action remains `Save source`. Returning to the first step or editing content in the review step does not silently spend another provider request; the user can choose `Suggest again` when they want the changed draft reclassified.

### Assistant response capture

The existing response-capture dialog already opens with a derived title and complete Markdown content. It automatically requests a suggestion when opened and displays the shared organization controls with the existing title/content review fields. Saving includes the accepted category and tags alongside the existing assistant-response provenance.

### Unavailable suggestions

If the notebook has no provider configuration, the provider rejects the request, the response cannot be parsed, or classification otherwise fails, the controls remain editable and start empty. The dialog shows:

> Couldn't suggest organization. You can choose it manually.

The failure does not close the dialog, erase edits, or prevent saving. `Suggest again` remains available in case the configuration or transient failure has changed.

## API Contract

Add a notebook-scoped endpoint:

```http
POST /api/notebooks/:id/source-organization-suggestions
Content-Type: application/json
```

Request:

```json
{
  "drafts": [
    {
      "index": 0,
      "title": "The Iron Compact",
      "content": "# The Iron Compact\n..."
    }
  ]
}
```

Response:

```json
{
  "suggestions": [
    {
      "index": 0,
      "category": "factions",
      "tags": ["iron-compact", "trade-league", "smugglers"]
    }
  ],
  "warning": null
}
```

When classification is unavailable, the endpoint still returns `200`:

```json
{
  "suggestions": [
    {
      "index": 0,
      "category": null,
      "tags": []
    }
  ],
  "warning": "Couldn't suggest organization. You can choose it manually."
}
```

The shared package owns strict Zod schemas and inferred types for the request, individual suggestion, and response. Request indices must be unique nonnegative integers. The endpoint accepts between 1 and 100 drafts, each using the existing source title and content limits, plus a cumulative content limit of 500,000 characters for a single classification request. Oversized conversion batches remain reviewable and saveable, but the client skips classification and presents the same manual-organization warning.

These limits bound classification prompts without changing the existing source import limits. They are deliberately independent from the batch-create maximum of 1,000 sources.

The endpoint validates the notebook before attempting provider work. A nonexistent notebook remains a normal `404`; only classification/configuration/provider failures become a successful blank-suggestion response.

## Server Architecture

### `SourceOrganizationService`

A focused service owns classification orchestration. It depends on:

- `NotebookService` to resolve the notebook and its provider configuration;
- `SourceService` to list the notebook's current metadata and collect existing tags; and
- `ProviderService` to perform one non-streaming completion.

It exposes a method equivalent to:

```ts
suggest(notebookId: string, drafts: SourceOrganizationDraft[]): Promise<SourceOrganizationResponse>
```

The service keeps prompting, parsing, normalization, and fallback policy out of source persistence and route handlers. It never writes source files or database rows.

### Provider support

`ProviderService` gains a narrow non-streaming completion operation that reuses the existing provider request builder, secret resolution, HTTP client, and provider response normalization. The source-organization service supplies messages and conservative generation controls; it does not call a provider-specific API directly.

Classification uses the notebook's exact configured source, model, base URL, and provider extras. If the notebook has no provider configuration, the organization service returns blank suggestions without initiating network work.

Suggested controls are deterministic and inexpensive: temperature `0`, no reasoning, and a bounded output-token budget scaled to the number of drafts. Provider-specific request conversion remains in `packages/providers`. The existing non-streaming HTTP path applies its 30-second timeout, after which classification falls back to manual organization.

### Existing tag vocabulary

The service collects distinct tags from the notebook's current source metadata, sorted deterministically. At most 200 tags are included in the prompt, capped again by a 10,000-character serialized limit. This is enough to encourage reuse without allowing a large notebook vocabulary to dominate the prompt.

The prompt tells the model to reuse an exact existing spelling when its meaning fits and to create a new lowercase tag only when no existing tag describes the concept. The existing `SourceService` normalization remains the final persistence boundary.

## Prompt and Response Handling

The classification prompt:

- defines the ten allowed category values;
- requests three to five concise, lowercase, comma-free tags per draft;
- supplies the bounded existing-tag vocabulary;
- labels source titles and content as untrusted reference data;
- explicitly tells the model not to follow instructions found in source content;
- requires one JSON object per request index; and
- forbids prose outside the JSON payload.

The drafts are serialized as JSON data inside clear delimiters. The response shape is:

```json
{
  "suggestions": [
    { "index": 0, "category": "factions", "tags": ["iron-compact"] }
  ]
}
```

The parser accepts a raw JSON object or one JSON object inside a Markdown code fence, since not every supported model reliably obeys a no-fence instruction. It does not attempt to repair arbitrary prose or malformed JSON.

Each returned item is parsed independently and matched by `index`, never by array order. A category outside `SOURCE_CATEGORIES` becomes `null` without discarding otherwise valid tags. Tags are handled independently: empty, comma-containing, non-string, or over-50-character values are removed; the remaining values are trimmed, lowercased, deduplicated case-insensitively, and capped at five.

When a generated tag case-insensitively matches an existing notebook tag, the existing spelling is used. Because persisted tags are already normalized to lowercase, this chiefly protects against model formatting drift and keeps the rule explicit.

Missing, duplicated, out-of-range, or non-object response items produce a blank suggestion for the affected draft. A duplicated index is treated as ambiguous and therefore blank. Invalid category or tag fields degrade independently as described above, and valid siblings in the same batch are preserved. A wholly unusable response produces blank suggestions for every draft and the standard warning.

Raw prompts, provider response bodies, API keys, internal errors, and provider-specific details are never returned to the browser. Failures use the server's existing sanitized error logging path, while the UI receives only the standard warning string.

## Persistence and Data Ownership

Suggestions are transient UI data. They are not stored when generated and do not require a database migration.

After user review, the existing create and batch-create endpoints receive ordinary `category` and `tags` fields. `SourceService` performs its existing validation and normalization, and `SourceFileStore` writes the accepted values to Markdown frontmatter. SQLite continues to mirror that file metadata as a rebuildable index.

There is no provenance field that distinguishes suggested metadata from manually entered metadata. Once the user saves it, it is simply source organization owned by the user.

## Client Architecture

The typed API client gains `suggestSourceOrganization(notebookId, input, signal?)`.

A reusable hook coordinates one suggestion attempt, cancellation on dialog close or draft replacement, loading state, warning state, and manual retry. A reusable organization-fields component renders the category and tags controls consistently across file import, paste, and response capture.

The hook does not retry automatically. This prevents hidden repeat provider spending. It ignores stale responses by associating each attempt with the submitted draft snapshot and aborting superseded requests where possible.

Each dialog owns its draft category and tag values. A successful result initializes those fields only for the attempt that requested it; it never overwrites edits made after that request began. `Suggest again` is an explicit overwrite action and can replace the current organization fields with the new result.

## Error Handling

- Missing notebook: ordinary API `404`.
- Invalid request or exceeded request bounds: ordinary validation `400`; the client avoids known oversized requests and falls back to manual controls.
- No notebook provider: `200` with blank suggestions and the standard warning.
- Missing secret, provider configuration error, HTTP failure, timeout, malformed completion, or invalid classification payload: `200` with blank or partially valid suggestions and the standard warning.
- Dialog closed during classification: abort the browser request and discard any eventual result.
- Classification succeeds but source save fails: preserve the reviewed category/tags and all other draft edits so the user can retry saving without another model call.

## Testing Strategy

### Shared package

- Accept valid batch requests and suggestion responses.
- Reject duplicate indices, empty batches, too many drafts, and cumulative oversized content.
- Enforce canonical categories and existing tag constraints.

### Server unit tests

- Build a deterministic prompt containing categories, bounded existing tags, draft indices, and the untrusted-content instruction.
- Use the notebook's configured provider/model and a non-streaming request.
- Return blank suggestions without network work when no provider is configured.
- Parse raw and fenced JSON.
- Match out-of-order results by index.
- Normalize, deduplicate, cap, and reconcile tags with existing vocabulary.
- Preserve valid siblings when one response item is malformed.
- Convert provider and parsing failures into the standard safe warning.
- Reject a nonexistent notebook and invalid/oversized input at the API boundary.

### Web tests

- File preview automatically requests a batch suggestion and saves edited category/tags per entry.
- Paste proceeds to organization review, automatically requests a suggestion, and saves edited values.
- Response capture requests on open and saves edited values with unchanged provenance.
- Loading, no-provider/failure warning, clear fields, cancellation, stale-response protection, and `Suggest again` behavior.
- Known oversized batches skip the request and remain manually organizable.

### End-to-end test

Extend the deterministic stub provider to recognize the classification prompt and return category/tag JSON. Cover an uploaded multi-entry source preview, edit one suggestion, save the sources, and verify the resulting organization labels in the source browser and source viewer.

## Documentation

- Update `docs/ROADMAP.md` to record automatic source organization as a later M3 enhancement rather than opening a new milestone.
- Update `docs/ARCHITECTURE.md` with the transient classification path and its failure-tolerant relationship to source persistence.
- No ADR is required because this design uses the established provider layer and Markdown-source-of-truth architecture without introducing a new durable architectural decision.

## Acceptance Criteria

- Every new-source path automatically attempts organization suggestions using the notebook's configured model.
- Suggested categories use only the canonical category list; suggestions contain no more than five normalized tags.
- Existing notebook tags are preferred when semantically appropriate.
- Users can edit or clear suggestions before any source is saved.
- One provider or parsing failure never blocks saving the affected source drafts.
- Accepted organization is persisted through the existing category/tag fields in source Markdown frontmatter and SQLite metadata.
- Classification does not run again silently after draft edits or save failures.
- Automated tests cover shared schemas, server classification behavior, all three web flows, and one deterministic browser journey.
