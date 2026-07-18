# Skill Kinds Expansion

**Date:** 2026-07-18

**Status:** Approved

## Purpose

Grow the bundled starter catalog beyond a single skill shape. The 2026-07-16 rewrite made every
bundled skill a **generative-first source-document producer** and encoded that as a one-size content
contract. Adding an interactive game facilitator, a meta authoring tool, and a multi-source adaptation
skill requires the catalog — and its automated contract — to recognize more than one kind of skill.

## Scope

Adds three bundled `SKILL.md` files, updates their attribution, adds a per-kind content contract to
`apps/server/src/services/starter-skills-content.test.ts`, and notes the change in the roadmap.

It does not change prompt assembly, presets, provider requests, the Skills UI, storage, or installation
semantics. New skills are discovered exactly like the existing ones — `StarterSkillService.readCatalog`
enumerates every directory under `apps/server/skills-starter/` — so no registration code changes.

## Skill Kinds

Each bundled skill declares a kind through its frontmatter `metadata.mode`. Every kind keeps a gated
`## Explicit Critique Mode` section so critique is available without defining default behavior.

- **generative** (`mode: generative+explicit-critique`, `type: generator`) — the existing contract:
  creation by default, finished source-ready Markdown, canon-aware, critique gated. Required sections:
  `## Creation Mode`, `## Source-Ready Output Contract`, `## Canon and Ambiguity`,
  `## Explicit Critique Mode`. Applies to the 16 original skills plus `adaptation-synthesis`.
- **interactive** (`mode: interactive`, `type: facilitator`) — runs a live experience one turn at a
  time rather than emitting a standalone document. Required sections: `## Facilitation Mode`,
  `## Session Contract`, `## Canon and Continuity`, `## Explicit Critique Mode`. Applies to
  `game-facilitator`.
- **authoring** (`mode: authoring`, `type: authoring`) — produces an artifact the user keeps (here, a
  `SKILL.md`), not story canon. Required sections: `## Authoring Mode`, `## SKILL.md Contract`,
  `## Output Contract`, `## Explicit Critique Mode`. Applies to `skill-creator`.

## New Skills

- **`adaptation-synthesis`** — adapted from `jwynia/agent-skills`
  `skills/creative/fiction/application/adaptation-synthesis`. Function-first adaptation: preserve what a
  source element accomplishes while changing its form, and fuse multiple sources around one backbone.
  The upstream `dna-extraction` dependency and JSON `dna-library/` persistence are dropped; extraction
  becomes a silent internal step over the selected sources, and orthogonality defers to the installed
  `cliche-transcendence` skill.
- **`game-facilitator`** — adapted from
  `skills/creative/fiction/application/game-facilitator` as an interactive, canon-aware narrative RPG
  facilitator. Upstream `.ts` tool scripts are dropped (ADR 0011); the facilitator can offer a session
  recap as a saveable source.
- **`skill-creator`** — worldbookllm-original. Authors a new `SKILL.md` of any kind, encoding the
  generative-first shared contract from the 2026-07-16 design spec.

## Verification

Automated tests read the real bundled catalog and verify that exactly the expected 19 directories are
present, that each `SKILL.md` has valid frontmatter with its directory as `name` and `license: MIT`,
and that each body satisfies the required section contract for its `metadata.mode` kind (generative
skills additionally keep diagnostic-first language out of their creation half). The ordinary starter
catalog still lists and installs every bundled skill.

Required gates: `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build`.

## Delivery

Committed on a feature branch and opened as a draft GitHub pull request; not deployed from this branch.
