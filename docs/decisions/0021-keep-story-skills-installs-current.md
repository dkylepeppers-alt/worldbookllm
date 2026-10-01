# ADR 0021 — Keep installed story-skills on the bundled version unless edited

**Status:** accepted · 2026-10-01 · amends ADR 0015 decision 6

## Context

ADR 0014 pins `story-skills` exactly, because the server runs only the `story` commands in its vendored command table, and the entity editors render from the pinned schema. Tests fail when the installed package drifts from either. Dependabot proposes upgrades, and CI decides whether they merge.

ADR 0015 decision 6 left skills already in a writer's data directory alone. A package upgrade therefore reached only new installs. Everyone else kept the text of the version they first installed, with reference repairs keyed to that version, so the agent ran on stale craft guidance while the CLI moved on.

Following upstream at runtime (`npx story-skills@latest`) was rejected: it would bypass the vendored command table and schema checks, and make startup depend on the network.

## Decision

1. **The package stays exact-pinned.** "Latest" means the version CI accepted: Dependabot opens `story-skills` updates as their own group, so they auto-merge (minor and patch) independently of other dependencies once the drift tests pass.
2. **Installs record a baseline.** Each installed skill folder gets `.story-skills.json`: the package version, the installed description, the SKILL.md body hash, and the hash of each reference file as installed. An install from before baselines existed gets one on the next refresh while it is still on the bundled version, and counts as untouched only if its description, SKILL.md body, and every upstream reference file on disk match upstream. Every install so far is on 0.18.0, the version this change ships with, so each gets a baseline at the first start. An install from an older version that never got a baseline cannot be classified and is kept.
3. **Unedited installs follow the bundled version.** When the bundled package is a newer semver than an install (an install newer than the bundled package, after a rollback, is left alone), the install moves to it only if its SKILL.md body, description, and every recorded reference file still match the baseline (a missing file is not an edit; a renamed skill is not followed). The new `references/` folder is assembled beside the old one, SKILL.md is rewritten through `SkillService` with the new origin, and then the folders are swapped, so a failure part way leaves the old version whole. Recorded reference files are replaced, or removed when upstream dropped them. Files the writer added stay. Baseline paths are confined to the skill's `references/` folder and never followed through symlinks, because the baseline lives in the writer-editable data directory.
4. **Edited installs are kept.** Any difference keeps the whole skill, files and origin, as it is. It is reported as kept, and the writer can delete it and reinstall to take the new version.
5. **Refresh runs at startup and on install.** Startup only refreshes existing installs; it never re-adds a skill the writer deleted. The Install Story Skills action also adds missing skills.

## Rationale

Comparing against a recorded baseline is the only reliable way to tell "untouched" from "edited" once the old package version is gone from `node_modules`. Upgrading a skill as a whole, rather than file by file, avoids a SKILL.md and its references disagreeing across versions. Keeping the pin keeps the CLI, schema, and skill text on one version that CI has checked together.

## Consequences

- Writers get upstream craft improvements without reinstalling, and their edits are never overwritten.
- An edited skill stops receiving upstream changes until the writer deletes and reinstalls it.
- Skill folders carry one extra dotfile that the app manages.
