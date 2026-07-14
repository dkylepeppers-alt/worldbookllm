# M4 Native Preset Studio and Response Capture

**Date:** 2026-07-14

**Status:** Saved planning baseline for M4 implementation

**Inspiration:** [SillyTavern Preset Creator](https://github.com/cha1latte/sillytavern-preset-creator)

## Goal and boundaries

M4 replaces hardcoded canon modes and task outputs with a native, global chat-completion preset library. Users can tune core generation controls, compose ordered prompt modules with full depth injection, inspect exactly what produced an exchange, and turn an assistant response into an inspectable Markdown source.

M4 does not add SillyTavern JSON compatibility, macros or variables, `min_p`, provider-specific sampler panels, large bundled module packs, or preset export. It keeps one generation pipeline parameterized by a small, versioned native preset schema.

## Product model

- Presets are reusable global records. One preset is the global default.
- A chat either inherits the global default or selects another global preset. Notebook defaults do not participate.
- The dedicated Preset Studio is a top-level `/presets` route beside Notebooks and Settings. It owns library management, generation controls, module editing, ordering, preview, and import.
- Chat shows the active preset selector, an active-preset indicator, and a quick temperature slider.
- Moving the chat temperature slider edits the selected global preset, affecting every chat that uses it. The UI states this scope explicitly and disables Send while the update is being saved.
- Preset edits affect future generations only. Every exchange stores an immutable snapshot of the preset and prompt it used.
- Migration seeds one editable **Grounded development** preset matching current behavior with temperature `0.7`.

## Native preset contract

The portable JSON shape is versioned and excludes database IDs and timestamps:

```json
{
  "schemaVersion": 1,
  "name": "Grounded development",
  "generation": {
    "temperature": 0.7,
    "topP": null,
    "maxTokens": null,
    "assistantPrefill": null
  },
  "modules": [
    {
      "key": "assistant-role",
      "name": "Assistant role",
      "kind": "custom",
      "role": "system",
      "content": "You are a creative writing and worldbuilding assistant.",
      "enabled": true,
      "insertion": { "position": "before_history" }
    },
    {
      "key": "sources",
      "name": "Selected sources",
      "kind": "sources",
      "role": "system",
      "content": null,
      "enabled": true,
      "insertion": { "position": "at_depth", "depth": 4 }
    }
  ]
}
```

Core controls are temperature, top-p, maximum output tokens, and optional assistant prefill. Temperature is required and ranges from `0` through `2` in UI steps of `0.05`. Top-p is nullable or greater than `0` through `1`. Maximum output tokens is nullable or an integer from `1` through `131072`. Assistant prefill is nullable or at most 32,768 characters and is visibly marked provider-dependent.

Module keys match `[a-z0-9][a-z0-9_-]{0,63}` and are unique within a preset. A preset contains at most 100 modules, each custom module contains at most 100,000 characters, and total custom prompt content is at most 1,000,000 characters. Enabled custom modules must contain non-whitespace content.

Every preset has exactly one protected `sources` module. It is always enabled, has the `system` role, expands to the chat's selected Markdown sources, and cannot be deleted or have its content edited. Its insertion point and order remain configurable. Chat history and the newest user message are protected structural anchors rather than stored modules.

## Prompt composition

Custom modules support `system`, `user`, and `assistant` roles, enabled state, drag ordering, and one of two insertion modes:

- `before_history` places the module in the initial instruction stack.
- `at_depth` uses a nonnegative integer depth. Depth `0` inserts immediately before the newest user message; depth `1` inserts before the last historical message; larger values move progressively earlier. A depth beyond available history places the module before all history.

Modules sharing an insertion point follow their displayed array order. The assembler deterministically combines before-history modules, depth-injected modules, eligible prior messages, the expanded Sources module, and the protected newest user message. Disabled modules are omitted. With no selected sources, the Sources module expands to the existing explicit “No sources selected” representation.

The Preset Studio preview shows the final canonical message sequence with source and history placeholders. Drag handles are supplemented by accessible move-up and move-down controls. Assistant prefill remains a generation parameter and is not inserted as a prompt module.

## Import behavior and documentation

Preset Studio accepts native `.json` files up to 1 MiB. The browser reads the file, and the server validates the complete document with the same strict shared schema used by the API. Unknown fields, unsupported schema versions, invalid ranges, duplicate keys, invalid content totals, and missing or duplicate Sources modules are rejected without creating data.

Before saving, the import dialog shows the name, generation controls, module count, and field-level validation errors. An import always creates a new preset, never overwrites an existing preset, and never changes the global default. A case-insensitive name collision receives the first available numeric suffix such as `Grounded development (2)`.

`docs/PRESET_SCHEMA.md` is the normative authoring reference. It documents the JSON shape, limits, insertion semantics, validation behavior, and complete examples. The README and import dialog link to it.

## Persistence and API boundaries

Database migration 003 adds:

- `presets` with ID, case-insensitive unique name, versioned definition JSON, and timestamps;
- singleton `app_settings` with the global default preset ID;
- nullable `chats.preset_id`, where `null` means inherit the global default.

Deleting the default preset is rejected. Deleting a non-default preset sets referencing chats back to inheritance. Existing notebook provider settings remain unchanged.

The server exposes native preset list, get, create, patch, and delete operations plus a global-default update. Chat create and patch gain nullable `presetId`. File import uses the normal preset-create boundary after local file reading; it does not need a second persistence path.

Generation resolves the chat's explicit preset or the global default, snapshots it, assembles canonical messages, and passes generation controls through the provider abstraction. Provider builders omit unsupported fields. The secret-free provider request body is captured after provider conversion; headers, API keys, and secret material are never stored in exchange context.

Message context becomes a backward-compatible union. Legacy messages retain the current source/provider/model/grounded shape. New messages store the preset snapshot, canonical messages, source IDs and hashes, requested controls, and effective request body. An in-flight generation keeps the snapshot taken during preparation even if the global preset changes concurrently.

## Response actions and prompt inspector

Every assistant message with non-empty content has **Inspect prompt** and **Add to sources** actions, including interrupted or errored responses with partial text.

The inspector shows:

- preset name and immutable preset snapshot;
- requested sampling controls and effective provider request fields;
- ordered canonical messages after depth insertion;
- exact expanded source content used for that exchange;
- raw provider request body with headers and secrets excluded.

Legacy exchanges show the limited context that was recorded and explain that their full prompt cannot be reconstructed. Later source edits or deletion do not alter a stored M4 snapshot.

**Add to sources** opens a review dialog prefilled with the full response and an editable title derived from the first Markdown heading or meaningful line. Interrupted or errored responses show a warning badge. Saving uses the existing source-creation pipeline, then navigates to the new source. Repeated saves are allowed so one response can become multiple edited sources.

Source provenance gains an assistant-response origin containing `chatId` and `messageId`. This structured origin is stored in both SQLite metadata and Markdown frontmatter, preserving the source-of-truth rule.

## Failure semantics

- Invalid preset imports and patches create no partial data and return field-level validation errors.
- A failed global temperature update restores the prior displayed value and keeps Send disabled until the request settles.
- Provider rejection preserves the exchange's prompt snapshot and normal error status.
- Unsupported generation controls are omitted rather than fabricated; the inspector shows what was actually sent.
- Default-preset deletion returns a conflict until another preset becomes default.
- Missing selected sources are explicit in the prompt; missing presets are treated as stored-data/configuration errors rather than silently inventing settings.

## Verification contract

Shared-schema tests cover valid imports, control ranges, insertion unions, duplicate keys, the protected Sources invariant, limits, unsupported versions, and unknown fields. Migration tests upgrade a version-2 database, preserve user data, seed one default preset, and verify chat inheritance.

Prompt-assembler tests cover before-history ordering, depth `0`, intermediate and oversized depths, same-depth order, disabled modules, empty sources, interrupted-history inclusion, and the protected newest-user position. Provider tests verify supported controls reach request bodies and unsupported controls are omitted.

Server tests cover preset CRUD, collision suffixes, global-default changes, inherited and explicit chat presets, default deletion conflicts, immutable exchange snapshots, and assistant-response provenance. Web tests cover Preset Studio CRUD/import, ordering controls, global temperature updates, chat preset selection, inspector rendering, validation errors, and review-before-save source creation.

The end-to-end journey imports a native preset, makes it global, changes module order and depth, changes temperature from chat, generates through the stub provider, verifies the exact inspector, and saves the response as a Markdown source with provenance.

M4 is complete when users can author or import reusable global presets, control sampling and prompt depth visibly, inspect what produced any new exchange, and turn an assistant response into a transparent Markdown source without copying and pasting.
