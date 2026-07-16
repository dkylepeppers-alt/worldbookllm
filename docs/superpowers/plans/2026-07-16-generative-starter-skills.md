# Generative Starter Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite all 16 bundled creative skills as generative-first playbooks that emit standalone, source-ready documents while retaining critique only when explicitly requested.

**Architecture:** Keep the existing prompt assembler and installation pipeline unchanged. Enforce the content contract in each self-contained `SKILL.md`, and add one catalog-level test that reads the real bundled files so later upstream updates cannot silently restore diagnostic-first behavior.

**Tech Stack:** Markdown/agentskills.io `SKILL.md`, TypeScript, Vitest, gray-matter, pnpm 9.

## Global Constraints

- Creation is the default; critique activates only on an explicit critique request.
- Creation responses contain only standalone source content: no preamble, explanation, rationale, citations, provenance, source references, or offers for more help.
- Treat selected source material as invisible canon.
- Ask one concise clarification question and do not draft when canon conflicts or a missing decision would materially change established canon.
- Do not change prompt assembly, preset behavior, providers, installation semantics, or existing user-installed skills.
- Preserve the upstream MIT license and identify the rewritten set as adapted from `jwynia/agent-skills` commit `e02ec7e226a6e4f8419fd3b88a1d8e472d421b32`.
- Do not stage unrelated screenshots, `.playwright-mcp/`, or `apps/web/.impeccable/critique/` artifacts.

---

### Task 1: Lock the Bundled Content Contract With a Failing Test

**Files:**

- Create: `apps/server/src/services/starter-skills-content.test.ts`

**Interfaces:**

- Consumes: the real `apps/server/skills-starter/<name>/SKILL.md` catalog and `gray-matter`.
- Produces: a regression contract for the 16 expected names, generative metadata, required behavioral sections, and forbidden diagnostic-first identity phrases.

- [ ] **Step 1: Add the catalog content test**

Create a Vitest suite that resolves `../../skills-starter` from `import.meta.url`, enumerates the exact 16 directory names, parses each `SKILL.md`, and asserts:

```ts
const REQUIRED_SECTIONS = [
  '## Creation Mode',
  '## Source-Ready Output Contract',
  '## Canon and Ambiguity',
  '## Explicit Critique Mode',
];

expect(parsed.data.name).toBe(starterId);
expect(parsed.data.metadata).toMatchObject({
  type: 'generator',
  mode: 'generative+explicit-critique',
});
for (const section of REQUIRED_SECTIONS) expect(parsed.content).toContain(section);

const creationInstructions = parsed.content.split('## Explicit Critique Mode')[0] ?? '';
for (const phrase of [
  'your role is diagnostic',
  'the writer does the writing',
  'diagnose what is wrong',
  'provide feedback',
]) {
  expect(creationInstructions.toLowerCase()).not.toContain(phrase);
}
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter @worldbookllm/server test -- starter-skills-content.test.ts`

Expected: FAIL on the current bundle because diagnostic skills do not contain the required creation contract and do not use generative-first metadata.

- [ ] **Step 3: Commit the failing test**

```bash
git add apps/server/src/services/starter-skills-content.test.ts
git commit -m "test: define generative starter skill contract"
```

### Task 2: Rewrite the 16 Starter Skills

**Files:**

- Modify: `apps/server/skills-starter/belief-systems/SKILL.md`
- Modify: `apps/server/skills-starter/character-arc/SKILL.md`
- Modify: `apps/server/skills-starter/character-naming/SKILL.md`
- Modify: `apps/server/skills-starter/cliche-transcendence/SKILL.md`
- Modify: `apps/server/skills-starter/dialogue/SKILL.md`
- Modify: `apps/server/skills-starter/economic-systems/SKILL.md`
- Modify: `apps/server/skills-starter/endings/SKILL.md`
- Modify: `apps/server/skills-starter/genre-conventions/SKILL.md`
- Modify: `apps/server/skills-starter/governance-systems/SKILL.md`
- Modify: `apps/server/skills-starter/prose-style/SKILL.md`
- Modify: `apps/server/skills-starter/scene-sequencing/SKILL.md`
- Modify: `apps/server/skills-starter/settlement-design/SKILL.md`
- Modify: `apps/server/skills-starter/story-idea-generator/SKILL.md`
- Modify: `apps/server/skills-starter/story-sense/SKILL.md`
- Modify: `apps/server/skills-starter/systemic-worldbuilding/SKILL.md`
- Modify: `apps/server/skills-starter/worldbuilding/SKILL.md`

**Interfaces:**

- Consumes: the shared contract and domain behavior in `docs/superpowers/specs/2026-07-16-generative-starter-skills-design.md`.
- Produces: 16 valid, self-contained agentskills.io instruction documents consumed unchanged by `StarterSkillService` and `PromptAssembler`.

- [ ] **Step 1: Replace frontmatter with generative-first metadata**

Keep each existing `name` and `license: MIT`. Rewrite `description` to begin with what the model creates. Use:

```yaml
metadata:
  author: jwynia; adapted by worldbookllm
  version: '2.0'
  type: generator
  mode: generative+explicit-critique
  domain: <existing-domain>
```

- [ ] **Step 2: Give every body the shared behavioral sections**

Every file must contain `## Creation Mode`, `## Source-Ready Output Contract`, `## Canon and Ambiguity`, and `## Explicit Critique Mode`. The output contract must directly prohibit preambles, explanations, rationale, citations, provenance, source references, and follow-up offers. Canon handling must distinguish reasonable invention from conflicts that require one concise question before drafting.

- [ ] **Step 3: Preserve and convert domain craft**

Retain useful principles from the upstream material, but express checklists as silent synthesis procedures and output requirements. Apply the exact domain mapping from the approved spec: broad synthesis for `worldbuilding`/`story-sense`; consequence cascades for `systemic-worldbuilding`; complete institutions for the four system-design skills; transformation structure for `character-arc`; culturally grounded naming for `character-naming`; direct content generation for dialogue, prose, scenes, endings, genres, story concepts, and cliche transformation.

- [ ] **Step 4: Gate critique explicitly**

Each critique section must say it applies only when the user explicitly asks to critique, assess, diagnose, review, or troubleshoot existing work. It may provide concise domain-specific review guidance, but must not leak that behavior into creation mode.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run: `pnpm --filter @worldbookllm/server test -- starter-skills-content.test.ts`

Expected: PASS for all 16 bundled skills.

- [ ] **Step 6: Commit the skill rewrite**

```bash
git add apps/server/skills-starter/*/SKILL.md
git commit -m "feat: make starter skills generative first"
```

### Task 3: Correct Attribution and Architecture Documentation

**Files:**

- Modify: `apps/server/skills-starter/ATTRIBUTION.md`
- Modify: `docs/decisions/0011-prompt-orchestrated-skills-library.md`
- Modify: `docs/ROADMAP.md`

**Interfaces:**

- Consumes: the provenance and adaptation rules in the approved spec.
- Produces: accurate licensing/provenance statements without changing runtime behavior.

- [ ] **Step 1: Rewrite the attribution statement**

Replace “vendored verbatim” with “adapted from.” Preserve the upstream repository, path table, commit, fetch date, and MIT license reference. State that worldbookllm rewrote the instruction bodies to be generative-first and source-ready while retaining domain frameworks and explicit-request critique support. Replace the “bodies stay verbatim” and re-vendoring instructions with rules requiring intentional adaptation and content-contract tests.

- [ ] **Step 2: Amend ADR 0011 and the roadmap**

Change only claims that the starter bodies are verbatim. Describe them as a curated, MIT-attributed set adapted from jwynia for source-ready generation. Preserve the architecture decision, milestone scope, and historical provenance.

- [ ] **Step 3: Run formatting and the focused server suite**

Run: `pnpm exec prettier --check apps/server/skills-starter docs/ROADMAP.md docs/decisions/0011-prompt-orchestrated-skills-library.md`

Run: `pnpm --filter @worldbookllm/server test -- starter-skills-content.test.ts skills-api.test.ts`

Expected: both commands exit 0.

- [ ] **Step 4: Commit documentation**

```bash
git add apps/server/skills-starter/ATTRIBUTION.md docs/ROADMAP.md docs/decisions/0011-prompt-orchestrated-skills-library.md
git commit -m "docs: record adapted starter skill provenance"
```

### Task 4: Complete Repository Verification

**Files:**

- Verify only; modify scoped files only if a check identifies a defect introduced by this branch.

**Interfaces:**

- Consumes: all implementation commits.
- Produces: fresh evidence that the branch satisfies repository gates.

- [ ] **Step 1: Inspect scope**

Run: `git status --short && git diff --check main...HEAD && git diff --stat main...HEAD`

Expected: only the spec, plan, 16 skills, one content test, attribution, ADR, and roadmap are tracked changes; unrelated untracked artifacts remain unstaged.

- [ ] **Step 2: Run all required gates**

Run sequentially:

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
```

Expected: every command exits 0. A Vite chunk-size warning is acceptable; errors and failed tests are not.

- [ ] **Step 3: Review the final commits and diff**

Run: `git log --oneline main..HEAD && git diff --check main...HEAD && git status --short --branch`

Expected: intentional commits only, no whitespace errors, and only unrelated user artifacts remain untracked.

### Task 5: Publish a Draft Pull Request

**Files:**

- No repository files created or modified.

**Interfaces:**

- Consumes: the verified feature branch.
- Produces: a pushed branch and draft PR targeting `main`.

- [ ] **Step 1: Verify GitHub CLI authentication**

Run: `gh --version && gh auth status`

Expected: GitHub CLI is installed and authenticated for `github.com`.

- [ ] **Step 2: Push the feature branch**

Run: `git push -u origin "$(git branch --show-current)"`

Expected: the branch is created on `origin` and local tracking is configured.

- [ ] **Step 3: Open the draft PR**

Create a draft PR targeting `main` with a title summarizing the generative rewrite. The body must explain the source-ready application workflow, the generative-first conversion, explicit critique gating, attribution changes, unchanged prompt/install semantics, and all verification commands.

- [ ] **Step 4: Report without deploying**

Return the PR URL, branch, commits, and verification results. Explicitly state that neither local checkout nor the Termux production server was updated from the feature branch.
