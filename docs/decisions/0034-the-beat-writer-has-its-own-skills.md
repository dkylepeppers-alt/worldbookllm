# ADR 0034 — The beat writer has its own skills

**Status:** accepted · 2026-10-13 · builds on ADR 0021 and ADR 0033

## Context

A custom agent picked as the discovery beat writer (ADR 0033) brings its instructions and the skills it names. The skills writers have are Story Skills, written for the chat agent. They are 7 to 22 thousand characters each, describe branching as `choices:` in chapter frontmatter and `story` CLI commands, and say when to use them as "when the user asks to …". The beat writer writes ink through `write_beat` and `write_choices` and can run none of that. A live comparison found models given Story Skills as a beat writer's skills did not use them.

What the beat writer needs is craft judgment for the calls it makes on every beat: how a beat turns, what makes a set of choices good, when to remember a choice, when to rejoin or end, keeping one voice across beats written apart, and what to do with the reader's own action.

## Decision

1. **worldbookllm ships six beat writer skills**, in `apps/server/beat-skills/`: `beat-shape`, `choice-design`, `memory-and-state`, `branch-economy`, `voice-continuity`, and `reader-actions`. They use only the beat writer's tools and terms, say when to use them in the beat writer's terms, leave out what its standing prompt already says, and stay under 3,000 characters each so the beat writer reads them whole.
2. **They install and upgrade like Story Skills** (ADR 0021), through the same installer. Their origin is `{ type: "beat-skills", package: "beat-skills@x.y.z", skillId }` and their licence is the repository's, AGPL-3.0-only. Unedited installs move to a new version at startup; edited ones are kept. A test fails when a file changes without a version bump.
3. **One action installs them and makes a "Beat writer" agent** that names all six: _Add the Beat writer agent_ on the story setup, `POST /api/beat-writer/install`. It picks the agent for the book. An agent already named "Beat writer" is left as the writer has it.
4. **They are ordinary skills once installed.** The writer can read, edit, or delete them on the Skills page, name them in their own agents, and change the agent. The default beat writer is unchanged.

## Rationale

Rewriting Story Skills for discovery upstream would put worldbookllm's tools and ink conventions into a package that does not know them. Folding the guidance into the standing prompt would hide it from the writer and make it all or nothing; as skills, the writer can see it, change it, and pick which parts their agent uses. Reusing the Story Skills installer keeps one tested path for installing, repairing, and upgrading bundled skills without touching a writer's edits.

## Consequences

- The beat writer has craft guidance that fits it, and a writer gets it with one button.
- Changing a beat writer skill means bumping `BEAT_SKILLS_PACKAGE` and recording the new hash in its test.
- A data directory with beat writer skills cannot be read by a build from before this ADR, since its skill origin is new.
- Whether named skills are pasted into the beat writer's prompt or loaded on demand is ADR 0033's to decide; these skills are sized to work either way.
