# Starter skill attribution

Most skills in this directory are adapted from
[jwynia/agent-skills](https://github.com/jwynia/agent-skills)
(`skills/creative/fiction/`), commit
`e02ec7e226a6e4f8419fd3b88a1d8e472d421b32`, fetched 2026-07-16. Two later
additions come from that repository's `skills/creative/fiction/application/`
tree on `main`, fetched 2026-07-18 (see the table). `skill-creator` is
worldbookllm-original and derived from no upstream skill.

Each adapted skill's `SKILL.md` declares `license: MIT` and credits `jwynia`
alongside the worldbookllm adaptation. The upstream MIT license text is
reproduced in `LICENSE` beside this file. The original domain frameworks
informed these skills, while worldbookllm rewrote the instruction bodies for a
generative-first workflow: attached skills create standalone, source-ready
documents by default and enter critique mode only on an explicit request.

Only the `SKILL.md` instruction files were adapted. Upstream `scripts/` and
`data/` companions are not included because worldbookllm injects skill
instructions into prompts and does not execute skill code (ADR 0011).

The catalog spans three skill kinds, distinguished by frontmatter
`metadata.mode`: **generative** source-document producers (the common case),
**interactive** facilitators that run a live session turn by turn
(`game-facilitator`), and **authoring** tools that emit an artifact for the
user to keep (`skill-creator`). `starter-skills-content.test.ts` enforces a
section contract per kind.

## Included skills

| Starter ID | Upstream path |
| --- | --- |
| adaptation-synthesis | skills/creative/fiction/application/adaptation-synthesis |
| belief-systems | skills/creative/fiction/worldbuilding/belief-systems |
| character-arc | skills/creative/fiction/character/character-arc |
| character-naming | skills/creative/fiction/character/character-naming |
| cliche-transcendence | skills/creative/fiction/craft/cliche-transcendence |
| dialogue | skills/creative/fiction/character/dialogue |
| economic-systems | skills/creative/fiction/worldbuilding/economic-systems |
| endings | skills/creative/fiction/structure/endings |
| game-facilitator | skills/creative/fiction/application/game-facilitator |
| genre-conventions | skills/creative/fiction/craft/genre-conventions |
| governance-systems | skills/creative/fiction/worldbuilding/governance-systems |
| prose-style | skills/creative/fiction/craft/prose-style |
| scene-sequencing | skills/creative/fiction/structure/scene-sequencing |
| settlement-design | skills/creative/fiction/worldbuilding/settlement-design |
| skill-creator | (worldbookllm-original) |
| story-idea-generator | skills/creative/fiction/core/story-idea-generator |
| story-sense | skills/creative/fiction/core/story-sense |
| systemic-worldbuilding | skills/creative/fiction/worldbuilding/systemic-worldbuilding |
| worldbuilding | skills/creative/fiction/worldbuilding/worldbuilding |

## Curation rules applied

- Prioritize what a worldbuilding workspace needs: the full self-contained
  `worldbuilding/*` frameworks, core character and story-craft skills, and the
  broad `story-sense` creative entry point.
- Preserve useful domain craft while converting coaching, diagnostic state
  machines, and feedback workflows into silent creation procedures.
- Require every skill to emit only standalone source content in creation mode,
  respect canon, stop for material conflicts, and gate critique behind an
  explicit request.
- Skills whose workflow depends on an agent loop we do not have yet
  (orchestrators) or on heavy `references/` trees were skipped; they can join
  a later adaptation pass (ADR 0011 phase 2).
- The 2026-07-18 pass added two `application/` skills: `adaptation-synthesis`
  (reworked onto worldbookllm sources — its upstream `dna-extraction`
  dependency and JSON `dna-library/` persistence were dropped, and orthogonality
  now defers to the installed `cliche-transcendence` skill) and
  `game-facilitator` (adapted as an interactive, canon-aware session runner).
  `skill-creator` was authored fresh to encode the generative-first contract.

## Updating

Update manually: review upstream changes, adapt useful revisions to the local
generative-first contract, update the commit hash above, and run the server
suite. `starter-skills-content.test.ts` enforces the behavioral contract and
`skills-api.test.ts` exercises catalog installation. Do not overwrite these
files with unadapted upstream bodies.
