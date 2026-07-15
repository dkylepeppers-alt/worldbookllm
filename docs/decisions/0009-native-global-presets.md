# ADR 0009 — Native global presets and immutable exchange snapshots

**Status:** accepted · 2026-07-15

## Context

M1 used one hardcoded grounded prompt and stored only limited source/provider/model context on assistant messages. M4 needs reusable creative controls, deterministic prompt composition, exact post-generation inspection, and a way to preserve useful responses as visible sources. Early roadmap language proposed canon modes, task presets, and per-notebook defaults, but those concepts overlap and create multiple inheritance and generation paths.

Portable presets also cross a trust boundary. Their schema must be explicit and versioned, selected sources must remain under chat control, and captured provider requests must be useful for inspection without persisting credentials or other secret transport data. Exchange records must continue to explain historical output even after presets or source files change.

## Decision

1. **Use a versioned native preset schema.** Presets contain portable generation controls and ordered prompt modules. Native JSON import uses the same strict shared schema as API creation. SillyTavern preset compatibility, macros, and export are outside M4.
2. **Keep presets global.** Exactly one preset is the application-wide default. A chat either inherits it or explicitly selects another global preset. Notebooks have no preset default, avoiding a second inheritance layer alongside their provider/model configuration.
3. **Protect source expansion.** Every preset has exactly one enabled, system-role Sources module. Users may reorder it and choose its insertion point/depth, but cannot delete it, edit its content, disable it, or change its role. The server expands it from the chat's selected Markdown sources.
4. **Assemble prompts deterministically.** Ordered enabled modules use `before_history` or integer `at_depth` insertion around eligible chat history. The newest user message remains a protected structural anchor rather than an editable module.
5. **Snapshot each exchange immutably.** Request preparation resolves chat-to-global inheritance and records the preset definition, canonical messages, source content and hashes, requested controls, provider/model, and provider-effective request body. The snapshot does not change when presets, app settings, chats, or sources later change.
6. **Exclude secrets and transport metadata.** Effective request capture stores the converted body only. It excludes headers, API keys, request URLs, and secret-store material.
7. **Capture responses as Markdown sources.** **Add to sources** creates a new source through the existing review and source-creation path. Its frontmatter and SQLite metadata use an `assistant-response` origin with the originating `chatId` and `messageId`.

## Consequences

- There is one generation pipeline parameterized by an explicit preset, rather than separate canon-mode or task-preset codepaths.
- Global edits affect every inheriting or explicitly selected chat on future generations, so the UI must state their scope and wait for saves before sending.
- A chat's active preset is predictable: explicit chat selection first, otherwise the one global default. Moving a notebook between workflows does not introduce hidden preset inheritance.
- The protected Sources module guarantees that source selection remains visible and server-controlled while still allowing prompt-order experimentation.
- Immutable snapshots consume more SQLite space because canonical messages and source content are duplicated per exchange, but they preserve auditability and survive later source or preset edits.
- Raw request-body capture can contain user-authored prompt content and provider parameters, but not authentication or URL/header secrets. Future provider integrations must preserve that boundary.
- Response capture creates inspectable, user-owned Markdown and structured provenance. Updating an existing source, diff review, and export remain later features.
