# Plan: Response controls, thinking, regenerate/variants, bulk sources, and preset schema v2

> Status: approved, ready to implement. Target branch: `claude/response-controls-prompt-schema-ieklql`.
> This document is self-contained: the Worldbook Engine v0.2 template that seeds the new
> default preset is embedded verbatim in the Appendix at the bottom.

## Implementation instructions for agents

Read `AGENTS.md` and `docs/ARCHITECTURE.md` first. Then:

- **Commands** (repo root, pnpm 9 / Node ≥ 20.19): `pnpm dev`, `pnpm test`, `pnpm lint`,
  `pnpm typecheck`, `pnpm build`, `pnpm format`. Single package, e.g.
  `pnpm --filter @worldbookllm/server test` (`.../web`, `.../shared`, `.../providers`, `.../e2e`).
- **Conventions**: strict TS (`strict` + `noUncheckedIndexedAccess`). `apps/server` is ESM with
  NodeNext — **relative imports need `.js` extensions**. ESLint flat config + Prettier at the root
  only; do not add per-package configs. `@worldbookllm/shared` is imported raw from `src/` (no build).
- **Do NOT edit `packages/providers`.** Reasoning (`includeReasoning`, `reasoningEffort`) and
  penalties (`frequencyPenalty`, `presencePenalty`) already exist there and are wired into every
  request builder (`packages/providers/src/types.ts:99-105`). The `providers-port` skill is therefore
  not in play for this work.
- **Skills to use**: `new-adr` (scaffold `docs/decisions/0010-*.md`), `verify` (boot the app and
  drive it with the Playwright MCP server for the end-to-end check). `source-ingestion` is not needed.
- **Suggested order of work** (each step should typecheck + test green before the next):
  1. `packages/shared` schema changes (preset v2, generation controls, message variants, context
     union) + their unit tests. This is the contract everything else depends on.
  2. Server: DB migrations 004 + 005, `ChatService`, `GenerationService`, `ProviderService`,
     `PromptAssembler`, routes + `app.ts` wiring, and tests.
  3. Web: `api/client.ts` + `api/stream.ts`, then `ChatMessages`, `ChatPanel`, `PresetControls`,
     `PresetsPage`, `SourceSelector`, and tests.
  4. Docs: rewrite `docs/PRESET_SCHEMA.md` to v2, add the ADR, update `docs/ARCHITECTURE.md` and
     `docs/ROADMAP.md`.
  5. e2e journey in `apps/e2e` against the deterministic stub provider.
- **Migrations are append-only and transactional** (`apps/server/src/db/database.ts`): add new
  numbered files, register them in the `MIGRATIONS` array, and bump `LATEST_SCHEMA_VERSION`
  implicitly (it is derived from the last entry). Never edit shipped migrations 001–003.
- **Provenance is sacred** (ADR 0009): existing exchange snapshots must still parse after the schema
  bump. Preserve them via the `contextVersion` union described below — mirror the existing
  `legacyGenerationContextSchema` pattern; do not drop or loosen old-snapshot validation.
- Keep milestones thin (`docs/ROADMAP.md`). Commit in the logical stages above with clear messages.

---

## Context

More user control over AI response generation in worldbookllm, driven by the Worldbook Engine v0.2
template (Appendix). Four changes, with the chosen approach for each:

1. **Thinking toggle** — a generation control that turns on model reasoning and exposes it in chat,
   collapsed behind a dropdown. Decided: **preset generation control** (shared across chats using
   that preset), not per-chat.
2. **Regenerate** — re-run a response you don't like. Decided: **keep prior responses as swipeable
   variants** (SillyTavern-style "swipes"), not replace-in-place.
3. **Bulk source selection**, with confirmation that **only the current chat is used for context**.
4. **Change the prompt-schema contract** using the template. Decided: **bump the portable preset
   schema to version 2** (reshape the contract) and seed the Worldbook Engine as the new default
   preset.

Key discovery from exploration: the **provider layer already fully supports** `includeReasoning`,
`reasoningEffort`, `frequencyPenalty`, and `presencePenalty` (`packages/providers/src/types.ts:99-105`,
wired in every request builder); streaming already accumulates/emits a separate `reasoning` field
(`apps/server/src/services/generation.ts:107-137`); the DB `messages` table already has a `reasoning`
column; `messageSchema.reasoning` exists; and the SSE `delta` event already carries `reasoning`. So
**`packages/providers` needs no edits**, and sources are already strictly per-chat scoped — there is
no cross-chat context bleeding today. The work is: shared schemas, server services/routes, two DB
migrations, and web UI.

---

## Feature 4 — Preset schema v2 (the prompt contract)

Reshape the portable contract in `packages/shared/src/presets.ts` from schemaVersion 1 to 2,
aligning to the template while keeping the app's hard requirements (per-module `role`/`insertion`,
exactly one protected Sources module).

**`generationControlsSchema`** — add three fields:

- `presencePenalty: z.number().min(-2).max(2).nullable()` (null = provider default)
- `frequencyPenalty: z.number().min(-2).max(2).nullable()`
- `thinking: z.boolean()` (Feature 1; default `false` on create)

**New `corePromptSchema`** — `z.strictObject({ content: z.string().trim().min(1).max(100_000) })`.
The core is always-active (cannot be disabled), emitted first as a `system` message before history.

**`customPresetModuleSchema`** — add `recommended: z.boolean()`. Keep `enabled` as the active on/off
state; `recommended` is authoring metadata (maps from the template's `recommended`).

**Root (`portablePresetShape`)** — `schemaVersion: z.literal(2)`, plus `core: corePromptSchema`,
optional `notes: z.string().max(20_000).nullable()` and `description: z.string().max(2_000).nullable()`
(carry the template's `notes_for_building_new_contract` and `description`). `presetSchema` extends it
with server-owned `id`/`createdAt`/`updatedAt` as today.

**Legacy support (provenance):**

- Add `upgradePresetV1ToV2(v1)` in `packages/shared/src/presets.ts`: keep name/modules (add
  `recommended: enabled` to each custom module); the v1 seed has no core, so set `core.content` to a
  sensible default (the old assistant-role text) and add penalty/`thinking` defaults. Freeze a
  `portablePresetV1Schema` used only to parse legacy inputs.
- Reuse this one function in both migration 004 and the import path.

**Assembler** (`apps/server/src/services/prompt-assembler.ts`): before the module loop, push
`{ role: 'system', content: preset.core.content }` as the first `beforeHistory` entry so it coalesces
with adjacent before-history system modules. No other assembly change.

**Provenance snapshot** (`packages/shared/src/chats.ts`): the current
`presetGenerationContextSchema` (`contextVersion: 2`) embeds the full `presetSchema`. Since that shape
changes, follow the existing `legacyGenerationContextSchema` precedent:

- Keep the current schema as a legacy variant whose embedded `preset` uses the frozen v1 preset schema.
- Add `presetGenerationContextV3Schema` with `contextVersion: z.literal(3)` embedding the new v2
  `presetSchema`.
- `generationContextSchema` union = `[legacy, v2-legacy-preset, v3]`. `generation.ts` writes
  `contextVersion: 3`.

**Migration 004** (`apps/server/src/db/migrations/004-preset-schema-v2.ts`, register in
`db/database.ts`):

- Rewrite every existing `presets.definition_json` v1 → v2 via `upgradePresetV1ToV2`.
- Insert a new **Worldbook Engine** preset built from the Appendix template: `core.content` =
  template core; `generation` = `{ temperature: 0.9, topP: 0.95, maxTokens: 8192,
assistantPrefill: null, presencePenalty: 0, frequencyPenalty: 0, thinking: false }`; each template
  module → custom module `{ key: id, name, kind:'custom', role:'system', content, enabled: recommended,
recommended, insertion:{position:'before_history'} }` plus one protected `sources` module;
  `notes`/`description` from the template.
- Repoint `app_settings.default_preset_id` to the Worldbook Engine preset (keep the upgraded
  "Grounded development" as a secondary preset).

**Docs:** rewrite `docs/PRESET_SCHEMA.md` for version 2; add ADR `docs/decisions/0010-*.md` covering
schema v2 + thinking + response variants; update the preset section of `docs/ARCHITECTURE.md` and a
ROADMAP note.

---

## Feature 1 — Thinking toggle (preset generation control)

- Schema: `thinking` added above.
- Wire-through (`apps/server/src/services/providers.ts` `createChatRequest`): pass
  `includeReasoning: controls.thinking` and `reasoningEffort: controls.thinking ? 'auto' : undefined`.
  Also pass `presencePenalty`/`frequencyPenalty` (null → undefined) here. No `packages/providers`
  change.
  - Caveat to document: for Claude, thinking only engages when `maxTokens` is set
    (`packages/providers/src/request/claude.ts:73`). The Worldbook Engine default sets
    `maxTokens: 8192`, so the default preset thinks; note this in the schema doc.
- Render reasoning collapsed with a dropdown:
  - `apps/web/src/chats/ChatMessages.tsx`: add a `reasoning` field to `PendingExchange`; render
    `message.reasoning` (active variant) as a collapsed `<details><summary>Thinking</summary>…</details>`
    in `MessageBody` and in the streaming/pending branch (guarded on non-empty reasoning).
  - `apps/web/src/chats/ChatPanel.tsx` `send()` `onEvent`: capture `event.reasoning` into the pending
    state (currently ignored).
- Control UI: add a "Thinking" checkbox to `apps/web/src/chats/PresetControls.tsx` (modeled on the
  temperature control; PATCHes `preset.generation.thinking` via `api.updatePreset`) and to the
  `PresetEditor` in `apps/web/src/presets/PresetsPage.tsx`. `minimalPreset()` must emit a valid v2
  (core content + `thinking:false` + penalties null).

---

## Feature 3 — Regenerate as swipeable variants

Store multiple assistant responses per turn inside the single assistant message row; the row's
`content`/`reasoning`/`status`/`context` columns always mirror the **active** variant, so the
assembler and all existing reads are unchanged.

**Migration 005** (`apps/server/src/db/migrations/005-message-variants.ts`):

- `ALTER TABLE messages ADD COLUMN variants_json TEXT` (nullable; null = one implicit variant from
  the existing columns).
- `ALTER TABLE messages ADD COLUMN active_variant INTEGER NOT NULL DEFAULT 0`.

**Shared** (`packages/shared/src/chats.ts`):

- `messageVariantSchema = { content, reasoning: nullable, status, context: generationContextSchema.nullable(), createdAt }`.
- `messageSchema`: add `variants: z.array(messageVariantSchema).min(1)` and
  `activeVariant: z.number().int().nonnegative()` (keep `content`/`reasoning`/`status`/`context` as
  the active mirror). `mapMessage` synthesizes a single-element `variants` array when `variants_json`
  is null.
- `patchMessageSchema = z.strictObject({ activeVariant: z.number().int().nonnegative() })`.

**ChatService** (`apps/server/src/services/chats.ts`):

- `beginExchange`: initialize the assistant row's `variants_json` to one interrupted variant,
  `active_variant = 0`.
- `updateAssistant`: update the columns AND rewrite `variants_json[active_variant]` in sync (one code
  path for send + regenerate).
- `beginRegeneration(assistantMessageId, context)`: append a new empty interrupted variant, set it
  active, reset the mirror columns, bump chat/notebook `updated_at`; return the `Message`.
- `selectVariant(messageId, index)`: bounds-check, assistant-only; set `active_variant` and copy that
  variant into the mirror columns; return the `Message`.

**GenerationService** (`apps/server/src/services/generation.ts`):

- `prepareRegeneration(chatId)`: reuse the `activeChats` guard; load detail; require the last message
  to be an assistant; set `newContent` = the immediately preceding user message and `history` =
  messages before it; resolve provider/preset, assemble, build request, snapshot `contextVersion:3`,
  call `chats.beginRegeneration`. Return `PreparedGeneration` with `assistant` = that message.
  `stream()` is reused unchanged.

**Routes:**

- `apps/server/src/routes/chats.ts`: add `POST /api/chats/:id/regenerate` (SSE, mirrors the messages
  route, no body).
- New `apps/server/src/routes/messages.ts`: `PATCH /api/messages/:id` → `selectVariant`; register in
  `apps/server/src/app.ts`.

**Web:**

- `apps/web/src/api/client.ts` + `apps/web/src/api/stream.ts`: `regenerateMessage(chatId, {signal,onEvent})`
  (generalize `streamChatMessage` to take a path/optional body) and `selectVariant(messageId, index)`
  (PATCH).
- `apps/web/src/chats/ChatPanel.tsx`: a `regenerate(message)` handler that streams live text/reasoning
  into a small `regen` state keyed by message id (rendered over that message), then refetches detail on
  completion; a `selectVariant` handler that refetches/updates local detail.
- `apps/web/src/chats/ChatMessages.tsx`: add `onRegenerate`, `onSelectVariant`, and a `regenStream`
  prop. Show a **Regenerate** button in `message-actions` only on the last assistant message; show
  swipe controls `‹ {activeVariant+1}/{variants.length} ›` when `variants.length > 1`; render the
  active variant's reasoning dropdown.

---

## Feature 2 — Bulk source selection (+ context assertion)

- `apps/web/src/chats/SourceSelector.tsx`: add **Select all** / **Clear all** buttons that each issue
  a **single** `api.updateChat(chatId, { sourceIds })` (all ids / `[]`) — the current code does one
  PATCH per toggle; bulk actions do one PATCH for the batch. Keep the optimistic-selection +
  `onSavingChange` pattern. Optionally support shift-click range selection.
- "Only the current chat is used for context" is **already true** (history is `WHERE chat_id = ?`;
  sources are `chat.sourceIds` only). No behavior change — add a confirming assembler test and a
  one-line UI note in the Grounding sources fieldset.

---

## Tests

- **shared**: v2 preset parse/reject-v1-as-current, `upgradePresetV1ToV2`, penalties + `thinking`
  controls, `messageVariantSchema`/`activeVariant`, `patchMessageSchema`.
- **server**: migration 004 (rows upgraded, default = Worldbook Engine), migration 005 (columns +
  backfill), presets service parse/upgrade, `createChatRequest` threads penalties + thinking,
  `prepareRegeneration` + variant append + mirror sync, `selectVariant`, assembler emits `core` first
  and uses only the current chat's sources/history.
- **web** (vitest + testing-library): `SourceSelector` bulk buttons issue one PATCH; `ChatMessages`
  reasoning dropdown, swipe controls, and last-message-only Regenerate button; `PresetControls`
  thinking toggle; `ChatPanel` captures streamed reasoning.
- **e2e** (`apps/e2e`, deterministic stub provider): a journey that enables thinking (renders the
  dropdown) and regenerates once (swipe count goes 1/1 → 1/2 and paging works).

## Verification

1. `pnpm --filter @worldbookllm/shared test && pnpm --filter @worldbookllm/server test && pnpm --filter @worldbookllm/web test`
2. `pnpm typecheck && pnpm lint && pnpm build`
3. End-to-end via the `verify` skill (boot server + web against a throwaway data dir, drive with the
   Playwright MCP server): confirm the Worldbook Engine preset is the default, toggle Thinking and see
   the collapsed reasoning dropdown on a response, click Regenerate and page between swipes, and use
   Select all / Clear all on sources. Then `pnpm --filter @worldbookllm/e2e test`.
4. Migration check: open an existing pre-change `data/` dir and confirm 004/005 upgrade cleanly and
   old exchange snapshots still load in the Prompt Inspector.

## Out of scope / notes

- No `packages/providers` changes — reasoning and penalty params already exist there.
- Preserving old exchange provenance (the `contextVersion` union) is deliberate; it mirrors the
  existing `legacyGenerationContextSchema` pattern.

---

## Appendix — Worldbook Engine v0.2 template (seed for the new default preset)

The migration 004 seed is built from this template. Each `modules[]` entry becomes a custom preset
module (`key` = `id`, `role: 'system'`, `enabled` = `recommended`, `insertion.before_history`); `core`
becomes the preset's `core.content`; `generation_defaults` maps to the preset `generation` controls
(adding `thinking: false`); `notes_for_building_new_contract` and `description` map to `notes` /
`description`.

```json
{
  "name": "Worldbook Engine",
  "version": "0.2",
  "description": "A high-signal, modular template for creative writing and worldbuilding systems. Designed as raw material for building a new prompt contract. Strong emphasis on source grounding, authentic world behavior, dynamic consistency, and high-quality prose craft. No safety language, no roleplay framing, no trackers, no regex, no guardrails of any kind.",
  "generation_defaults": {
    "temperature": 0.9,
    "top_p": 0.95,
    "max_tokens": 8192,
    "presence_penalty": 0.0,
    "frequency_penalty": 0.0
  },
  "core": {
    "id": "worldbook-engine-core",
    "content": "## Worldbook Engine — Core Directives\n\nYou are a precise and imaginative collaborator for creative writing and worldbuilding.\n\n### Foundational Rules\n- Treat all provided sources as the living canon of the project. Every response must be traceable to those sources or be a clear, logical extension of them.\n- Preserve the established facts, tone, rules, aesthetics, and implications of the sources with absolute fidelity. Never override or contradict them.\n- All entities (individuals, groups, institutions, natural systems, cultural forces) possess independent agency, internal logic, history, desires, limitations, and contradictions. They behave according to their nature even when it creates friction or inconvenience.\n- The world is dynamic. Events have consequences. Time passes. Resources are consumed. Information travels at realistic speeds. Social, political, economic, and physical systems have inertia and react to change.\n- You may invent freely inside the gaps, implications, and spirit of the sources. You may not invent against them.\n- Distinguish clearly between what is directly supported by sources, what is strong inference, and what is creative addition when it serves clarity.\n\n### Creative Stance\n- Be specific, concrete, and sensory. Favor named details, textures, light qualities, sounds, and physical consequences over vague summary or abstraction.\n- Develop logical second- and third-order effects. Consider what would realistically happen off-screen or between scenes.\n- Maintain consistent voice, terminology, and cultural logic across the entire project.\n- When generating prose, dialogue, or description, respect the established speech patterns, education, status, and personality of every speaker or actor.\n- Offer multiple viable directions when the request is open-ended, each grounded in different aspects of the source material.\n\n### Task Adaptability\nAdapt your behavior to the actual request:\n- When answering questions about the world: be accurate, cite sources where relevant, and surface interesting implications or gaps.\n- When drafting scenes or prose: produce vivid, grounded writing that advances the established logic and leaves room for continuation.\n- When expanding lore: develop under-explored elements into coherent, lived-in additions that feel native to the existing material.\n- When stress-testing or critiquing: identify tensions, contradictions, and opportunities with precision and suggest grounded resolutions or evolutions.\n- When the user wants wilder invention: push further into the implications and aesthetic of the sources while remaining internally consistent.\n\nYou are not a passive tool. You are an active, knowledgeable creative partner who protects the integrity of the work while helping push it forward."
  },
  "modules": [
    {
      "id": "continuity-fidelity",
      "name": "Continuity & Canon Fidelity",
      "content": "Before producing any new material:\n- Recall and strictly respect all established facts relevant to the current topic from the sources and prior context.\n- Identify any tension or contradiction that would be created by fulfilling the request exactly as stated.\n- If a contradiction exists, state it plainly and offer the smallest change that preserves the spirit and logic of the sources, or explain the incompatibility.\n- Prefer solutions that add interesting new texture rather than simple retcons.\n- Maintain strict consistency with previously established timelines, knowledge states, capabilities, and causal chains.",
      "recommended": true
    },
    {
      "id": "creative-expansion",
      "name": "Creative Expansion",
      "content": "When asked to expand, generate new material, or invent:\n- Use existing elements (minor references, cultural practices, geographic features, historical events, character offhand comments) as seeds.\n- Develop logical consequences, hidden motivations, cultural ripple effects, and previously unseen corners of the world.\n- Stay inside the established aesthetic, ruleset, and implications of the sources.\n- Provide 2–3 distinct directions when appropriate, each drawing from different parts of the source material.\n- Clearly mark what is new invention versus what is directly supported or strongly implied.",
      "recommended": false
    },
    {
      "id": "prose-craft",
      "name": "Prose Craft & Sensory Detail",
      "content": "When generating narrative prose, description, or dialogue:\n- Use concrete sensory detail (light quality, texture, sound, temperature, smell, physical sensation) rather than abstract adjectives.\n- Vary sentence rhythm and length. Combine observation and action into flowing sentences.\n- Reveal character, emotion, and world through behavior, micro-details, and choice rather than exposition.\n- Respect the established narrative distance and point of-view conventions.\n- Avoid overwriting. Let important moments land cleanly.\n- Match dialogue to each speaker’s vocabulary, cadence, education, and cultural background as defined in the sources.",
      "recommended": false
    },
    {
      "id": "timeline-causality",
      "name": "Timeline & Causality",
      "content": "Maintain rigorous awareness of time and cause-and-effect:\n- Track what has happened, what is currently happening, and what must logically follow.\n- Account for travel times, communication delays, resource consumption, preparation requirements, and information flow.\n- Surface realistic off-screen consequences and reactions that would occur between scenes.\n- When the user proposes something with impossible or highly implausible timing or logistics, flag the issue and suggest adjustments that respect the world’s constraints.",
      "recommended": false
    },
    {
      "id": "faction-system-logic",
      "name": "Faction & System Logic",
      "content": "Treat groups, institutions, cultures, and large-scale systems as having coherent internal logic:\n- Factions and institutions have goals, internal divisions, resource limits, information asymmetries, and historical memory.\n- Decisions produce second- and third-order effects that ripple outward.\n- Cultural, religious, economic, and political systems have inertia and internal contradictions.\n- When generating responses involving groups, consider what different subgroups or individuals inside them would actually do given their established character and situation.\n- Avoid treating large entities as monolithic unless the sources explicitly support unified action.",
      "recommended": false
    },
    {
      "id": "contradiction-audit",
      "name": "Contradiction & Consistency Audit",
      "content": "When reviewing material or proposed changes:\n- Systematically check for contradictions with the sources and within the new material itself.\n- Distinguish between hard contradictions (must be resolved) and productive creative tensions (can be explored).\n- Present conflicts clearly with reference to the specific sources involved.\n- Offer grounded resolution options ranked by fidelity to the original material.",
      "recommended": false
    },
    {
      "id": "response-structure",
      "name": "Response Structure",
      "content": "Structure responses for maximum usefulness to a writer or worldbuilder:\n- Lead with the most relevant output (answer, draft, options).\n- Use clear section headings when addressing multiple parts of a request.\n- When offering variants, label them distinctly and explain the key differences and trade-offs.\n- When referencing sources, be precise.\n- Keep meta-commentary minimal and clearly separated from creative output.\n- When appropriate, end with 1–3 sharp observations or questions that could productively deepen the work.",
      "recommended": false
    },
    {
      "id": "mode-continuity-check",
      "name": "Mode: Continuity Check",
      "content": "Operate in Continuity Check mode.\n\nFocus on:\n- Verifying consistency between new material and existing sources\n- Precisely identifying contradictions, timeline breaks, capability mismatches, and tonal drift\n- Explaining why something conflicts with canon (with source references)\n- Proposing minimal faithful fixes or explaining why a clean resolution is difficult\n\nDo not generate expansive new creative content unless asked. Prioritize diagnostic clarity and protection of the established world.",
      "recommended": false
    },
    {
      "id": "mode-scene-draft",
      "name": "Mode: Scene Drafting",
      "content": "Operate in Scene Drafting mode.\n\nPrioritize:\n- Vivid, grounded prose that respects the established tone, sensory palette, and logic of the sources\n- Accurate portrayal of every actor’s knowledge, personality, current situation, and limitations\n- Logical progression of events given prior context and world rules\n- Leaving meaningful space for user continuation rather than over-resolving\n\nWhen a beat has multiple strong possibilities, offer 1–2 alternative phrasings or directions.",
      "recommended": false
    },
    {
      "id": "mode-lore-expansion",
      "name": "Mode: Lore Expansion",
      "content": "Operate in Lore Expansion mode.\n\nFocus on:\n- Developing previously mentioned but under-explored elements into coherent, lived-in additions\n- Creating material that feels like it always belonged to the world\n- Providing multiple distinct directions the user could pursue\n- Clearly separating sourced material, strong inference, and new invention\n\nUse structured output (bullets, short prose, maps, timelines) when it increases clarity.",
      "recommended": false
    }
  ],
  "notes_for_building_new_contract": "This template is intentionally free of any preset schema so it can serve as raw material for designing a completely new contract format. The core is meant to be always active. Modules are designed to be selectively enabled based on the specific creative task. Generation defaults are only starting suggestions. Remove, rewrite, combine, split, or extend any part as needed when creating your own system. The emphasis is on maximum creative power paired with rigorous internal consistency and deep source fidelity."
}
```
