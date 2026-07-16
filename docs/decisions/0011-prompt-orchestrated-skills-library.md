# ADR 0011 — Prompt-orchestrated creative skills library

**Status:** accepted · 2026-07-16

## Context

Worldbuilders benefit from reusable craft instructions — how to design a settlement, sustain a character's voice, diagnose a stalled story. An open ecosystem of such instructions already exists: the Agent Skills specification (agentskills.io) defines a skill as a directory whose `SKILL.md` carries `name`/`description` frontmatter and a Markdown instruction body, and MIT-licensed fiction skill collections (notably jwynia/agent-skills) publish dozens of them. We want these usable inside chat, and we want a path toward an integrated agent that selects skills itself.

Two constraints shape the design. First, native tool calling was deliberately not ported in M1: `packages/providers` (ADR 0005, AGPL port) builds requests without tool definitions and its stream normalizer drops tool-call deltas, so a tool-driven agent would require port-governed changes across all 26 providers. Second, ADR 0009 fixed a single deterministic generation pipeline with an immutable per-exchange snapshot; any injected instruction content must remain visible in that record, and the portable preset contract (schemaVersion 1) must keep validating existing presets and stored snapshots.

## Decision

1. **Skills are user-visible Markdown on disk.** Each skill lives at `data/skills/<name>/SKILL.md` in the agentskills.io format — spec fields (`name`, `description`, `license`) plus worldbookllm-managed extra frontmatter keys (`id`, `origin`, timestamps), which the spec permits. SQLite indexes them in a `skills` table, rebuildable from the files (extends ADR 0003). The MVP reads only `SKILL.md`; other files in a skill directory are preserved but ignored.
2. **Skills are global, selected per chat.** Like presets (ADR 0009) and unlike sources, skills are craft configuration that crosses notebooks. The skill `name` is a unique slug identity matching its directory. Chats carry a `skillIds` array parallel to `sourceIds`.
3. **Execution is prompt-orchestrated, not tool-driven.** Attached skills are expanded into a `## Skills` system message emitted immediately after the protected Sources module, at the same insertion position. `packages/providers` is untouched.
4. **No preset schema change.** The portable contract demands exactly one Sources module; adding a required module kind would invalidate every stored preset, snapshot, and portable import. Skill placement therefore piggybacks on the Sources module's position. An optional `skills` module kind for independent placement is a possible follow-up.
5. **The exchange snapshot captures skill content additively.** `presetGenerationContextSchema` gains an optional `skills` array (id, name, description, content hash, content) at `contextVersion` 2, following the additive precedent set by the `thinking` control. Old snapshots still validate; the Prompt Inspector shows exactly what was injected.
6. **A curated starter set ships bundled.** Self-contained fiction skills adapted from jwynia/agent-skills ship with the upstream MIT license text and an attribution manifest (source repo, commit, per-skill list). Their domain frameworks are retained, while their instruction bodies are adapted for generative-first, source-ready output with critique available only on explicit request. The set is installable idempotently from the UI. Import-by-URL waits for M2's URL acquisition; MIT-in-AGPL bundling is compatible.
7. **Later phases are designed for, not built.** Phase 2 is a server-side model-driven activation loop: inject only the skill catalog (names + descriptions — the spec's progressive disclosure), detect an activation sentinel in streamed text, re-assemble with the skill body, re-issue. Phase 3 swaps that protocol for native tool calling outside the AGPL port. The MVP's `SkillService.list()`/`get()` are already the catalog and activation calls both phases need, and the snapshot field records whatever was injected regardless of who selected it.

## Rationale

Prompt injection over tool calling keeps the feature working across all 26 providers today with zero risk to the port boundary, and skills are pure instructions — they gain nothing from function-call semantics until an agent loop exists. Files-on-disk over a database-only store follows the project's core transparency principle and makes skills round-trip with the agentskills ecosystem (export is a folder copy). Global scope mirrors presets because a voice-consistency skill is no more notebook-specific than a temperature setting. Bundling the starter set rather than fetching at install keeps the app local-first and offline-installable.

## Consequences

- Users get a skills library that is greppable, hand-editable, and portable; edits outside the app reconcile on next access exactly as sources do.
- Skill text occupies context window on every generation for which it is attached; users manage this by attaching selectively, as with sources.
- Skill placement is tied to the Sources module's insertion until an optional skills module kind exists, which limits placement experimentation.
- Deleting a skill leaves stale `skillIds` on chats, failing the next generation the same way deleted sources do today — accepted parity, surfaced at generation time.
- Snapshots grow by the injected skill content per exchange, extending ADR 0009's deliberate space-for-auditability trade.
- The bundled starter set adds adapted MIT-licensed third-party text to the repository, with attribution tracked in-tree; updates require manual review and adaptation rather than blind re-vendoring.
