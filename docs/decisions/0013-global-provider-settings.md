# ADR 0013 — Single global provider/model setting

**Status:** accepted · 2026-07-18

## Context

Since M1, provider/model configuration lived on the notebook (a default) with an optional per-chat override, resolved as `chat.providerOverride ?? notebook.settings` wherever generation or source-organization needed a provider. ADR 0009 leaned on this as a given constraint — keeping presets global specifically to avoid "a second inheritance layer alongside their provider/model configuration."

In practice this per-notebook/per-chat layering was never used: every notebook in a workspace ends up pointed at the same provider and model, and per-chat overrides existed but were not a workflow anyone wanted. The layering added a second configuration surface (a "Configure provider" control repeated in the chat panel header, plus a per-chat override editor with its own clear/inherit affordance) for a case that does not occur, while the actual place a user looks for provider setup — the Settings page — only managed API keys, not which provider or model those keys apply to.

## Decision

1. **Provider/model configuration is a single global setting**, stored on the existing `app_settings` singleton row alongside the default preset (the same row ADR 0009 already used for the global default preset). `Notebook.settings` and `Chat.providerOverride` are removed from the schema entirely — not deprecated or kept nullable for compatibility.
2. **Every notebook and chat resolves the same provider config** by reading `AppSettings.providerConfig` directly. `GenerationService` and `SourceOrganizationService` no longer depend on `NotebookService` for configuration; they read it from `PresetService`, which already owns the `app_settings` table.
3. **Configuration lives on the Settings page**, next to the API key registry it already owned, via the existing `ProviderConfigDialog` reused unchanged. The chat panel's per-notebook header and per-chat override controls are deleted rather than pointed at the new setting, since there is nothing left for them to configure once resolution is global.
4. **Migration 007** adds `app_settings.provider_config_json`, seeds it from whichever notebook was most recently updated with a non-null `settings_json` (best-effort continuity for a single-provider workspace — a workspace with several differently-configured notebooks keeps only one and must reconfigure the rest once), then drops `notebooks.settings_json` and `chats.provider_override_json`.

## Consequences

- One place to configure a provider, matching how the feature is actually used; no more explaining why a chat's "Use notebook default" button exists.
- `GenerationService`'s constructor drops its `NotebookService` dependency entirely — provider resolution no longer needs to look up the chat's notebook at all.
- The migration is lossy for a workspace that genuinely had different notebooks pointed at different providers: only the most recently updated one survives automatically, the rest silently fall back to unconfigured until the user revisits Settings. This is accepted as a one-time cost since no known workflow relied on per-notebook divergence.
- `PATCH /api/app-settings` changes from a full-object PUT-like body (`{ defaultPresetId }`) to a genuine partial patch (`{ defaultPresetId? , providerConfig? }`, at least one required), matching the pattern the rest of the API already uses.
- ADR 0009's point 2 is superseded in spirit, though not in conclusion: presets stay global for the reasons already given, and provider/model configuration now sits at the same single global layer instead of being the second layer that justified keeping presets simple.
