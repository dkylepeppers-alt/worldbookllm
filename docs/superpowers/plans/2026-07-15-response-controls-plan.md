# Plan: Response controls — thinking, regenerate/variants, bulk sources, edit sources

> Status: implemented. This records the design that shipped. An earlier draft that reshaped the
> preset schema to version 2 (seeding a "Worldbook Engine" preset) was dropped in favour of the
> smaller, additive scope below.

## Context

Give users more control over AI response generation, without changing the portable preset contract:

1. **Thinking toggle** — a preset generation control that turns model reasoning on and shows it in
   chat, collapsed behind a `<details>` dropdown.
2. **Regenerate** — re-run the last response, keeping prior responses as swipeable variants.
3. **Bulk source selection** — Select all / Clear all on the per-chat source picker.
4. **Edit saved sources** — edit a saved source's title and/or content after ingestion.

The provider layer already supported `includeReasoning`/`reasoningEffort` end-to-end, streaming
already carried a separate `reasoning` field, and sources were already per-chat scoped, so
`packages/providers` needed no changes and there was no preset schema-version bump.

## What shipped

**Thinking (schemaVersion 1, additive):** `thinking: z.boolean().optional()` on
`generationControlsSchema` (`packages/shared/src/presets.ts`); optional so older presets, imports,
and exchange snapshots still validate. `ProviderService.createChatRequest`
(`apps/server/src/services/providers.ts`) passes `includeReasoning: true` + `reasoningEffort: 'auto'`
when set. Reasoning renders as a collapsed disclosure in `ChatMessages.tsx`; `ChatPanel` captures
`event.reasoning`. A "Thinking" checkbox lives in `PresetControls.tsx` and the Preset Studio editor.
Caveat: Claude only thinks when `maxTokens` is set. Documented in `docs/PRESET_SCHEMA.md`.

**Regenerate as variants:** migration `004-message-variants` adds `variants_json` (nullable = one
implicit variant) and `active_variant` to `messages`. `messageSchema` gains optional `variants` +
`activeVariant`; the mirror columns (`content`/`reasoning`/`status`/`context`) always reflect the
active variant, so the assembler and existing readers are unchanged. `ChatService` gains
`beginRegeneration` and `selectVariant` and keeps `variants_json[active]` in sync inside
`updateAssistant`. `GenerationService.prepareRegeneration` rebuilds the prompt from the last user
turn and appends a new variant. Routes: `POST /api/chats/:id/regenerate` (SSE) and
`PATCH /api/messages/:id` (`registerMessageRoutes`). Web: `regenerateMessage` streams over the target
message; `selectVariant` pages between swipes (`‹ n/m ›`); Regenerate shows only on the last
assistant message.

**Bulk source selection:** `SourceSelector.tsx` routes all changes through a single `persistSelection`
PATCH and adds Select all / Clear all.

**Edit saved sources:** `patchSourceSchema` (`packages/shared/src/sources.ts`) and
`SourceService.patch` — reuses `SourceFileStore.write` to rewrite the file (recomputing slug, hash,
word count) preserving `id`/`createdAt`/`origin`, removes the old slugged file on a title change, and
rolls the file back on failure. Route `PATCH /api/sources/:id`; client `updateSource`; an Edit
affordance in `SourceViewer.tsx`. No migration needed.

## Verification

- `pnpm test && pnpm typecheck && pnpm lint && pnpm build && pnpm format:check` all pass.
- Manual `verify`-skill pass: toggle Thinking and see the reasoning dropdown, Regenerate and page
  between swipes, Select all / Clear all, and edit a saved source and confirm it persists.
