# Starter skill attribution

The skills in this directory are vendored verbatim from
[jwynia/agent-skills](https://github.com/jwynia/agent-skills)
(`skills/creative/fiction/`), commit
`e02ec7e226a6e4f8419fd3b88a1d8e472d421b32`, fetched 2026-07-16.

Each skill's `SKILL.md` declares `license: MIT` in its frontmatter and names
`jwynia` as its author; the MIT license text is reproduced in `LICENSE`
alongside this file. Only the `SKILL.md` instruction files are vendored — the
upstream `scripts/` companions (optional Deno analysis tools some skill bodies
mention) are not included, because worldbookllm injects skill instructions
into prompts and does not execute skill code (ADR 0011).

## Included skills

| Starter ID | Upstream path |
| --- | --- |
| belief-systems | skills/creative/fiction/worldbuilding/belief-systems |
| character-arc | skills/creative/fiction/character/character-arc |
| character-naming | skills/creative/fiction/character/character-naming |
| cliche-transcendence | skills/creative/fiction/craft/cliche-transcendence |
| dialogue | skills/creative/fiction/character/dialogue |
| economic-systems | skills/creative/fiction/worldbuilding/economic-systems |
| endings | skills/creative/fiction/structure/endings |
| genre-conventions | skills/creative/fiction/craft/genre-conventions |
| governance-systems | skills/creative/fiction/worldbuilding/governance-systems |
| prose-style | skills/creative/fiction/craft/prose-style |
| scene-sequencing | skills/creative/fiction/structure/scene-sequencing |
| settlement-design | skills/creative/fiction/worldbuilding/settlement-design |
| story-idea-generator | skills/creative/fiction/core/story-idea-generator |
| story-sense | skills/creative/fiction/core/story-sense |
| systemic-worldbuilding | skills/creative/fiction/worldbuilding/systemic-worldbuilding |
| worldbuilding | skills/creative/fiction/worldbuilding/worldbuilding |

## Curation rules applied

- Prioritize what a worldbuilding workspace needs: the full self-contained
  `worldbuilding/*` frameworks, core character and story-craft skills, and the
  `story-sense` diagnostic entry point.
- Bodies stay verbatim (no edits), ≤ 520 lines, well under the app's 200k
  character limit.
- Skills whose workflow depends on an agent loop we do not have yet
  (orchestrators) or on heavy `references/` trees were skipped; they can join
  a later vendoring pass (ADR 0011 phase 2).

## Updating

Re-vendor manually: copy the upstream `SKILL.md` files over these directories,
update the commit hash above, and re-run the server test suite
(`skills-api.test.ts` exercises the catalog).
