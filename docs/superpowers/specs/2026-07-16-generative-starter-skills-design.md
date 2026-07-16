# Generative Starter Skills Design

**Date:** 2026-07-16

**Status:** Approved

## Purpose

Rewrite worldbookllm's 16 bundled creative skills so their default behavior is to create new,
source-ready material from the user's request and selected notebook sources. The skills must stop
behaving like writing coaches that automatically diagnose, critique, or explain the supplied
material.

The application workflow is source-oriented: users upload or create original sources, ask a model
to expand that canon, and may save the response as another original source. A creation response
therefore needs to stand on its own after it is detached from the chat that produced it.

## Scope

This change rewrites the bundled `apps/server/skills-starter/*/SKILL.md` files, updates their
attribution, and corrects documentation that describes them as vendored verbatim. It adds automated
content-contract coverage for the real bundled catalog.

It does not change prompt assembly, presets, provider requests, the Skills UI, installation
semantics, or user-installed copies under `data/skills/`. Installed starters remain user-owned and
editable; a repository update must never overwrite them.

## Shared Behavior Contract

Every bundled skill must impose the following rules in creation mode:

1. Creation is the default. The model produces new material or expands existing canon instead of
   evaluating the material it receives.
2. The response is finished, source-ready Markdown. It is not advice, a list of possible
   improvements, a critique, or an explanation of what the model could write.
3. The response begins directly with the requested content. It contains no preamble, creative
   rationale, process commentary, citations, provenance, references to "the sources," or offers for
   further help.
4. Selected source material is treated as invisible canon. The model synthesizes and extends it
   without identifying it as source material.
5. Ordinary gaps are filled through reasonable invention. If available canon conflicts, or a
   missing decision would materially change established canon, the model asks one concise
   clarification question and does not draft until the user answers.
6. The document form follows the request. An explicitly requested in-world form such as a letter,
   chronicle, scripture, scene, or transcript is emitted without reference-document scaffolding.
   Otherwise, the model creates a polished reference entry, normally with a descriptive Markdown
   heading and useful subsections.
7. The model performs craft checks silently. Checklists and procedures guide generation but do not
   appear as commentary in the response.

Critique mode activates only when the user explicitly asks to critique, assess, diagnose, review,
or troubleshoot existing work. Supplying imperfect or incomplete material does not activate
critique. Each skill keeps this mode in a clearly separated section so critique remains available
without defining the default behavior.

## Skill Structure

Each `SKILL.md` remains self-contained and uses this organization:

- agentskills.io-compatible frontmatter with a generation-first description and generative-first
  metadata;
- purpose and activation cues;
- the shared creation and output contract;
- domain principles;
- a silent synthesis workflow;
- domain decisions and completeness checks;
- output guidance appropriate to the domain; and
- an explicitly gated critique mode.

The rewrite preserves useful upstream craft frameworks but removes diagnostic state machines,
writer-coaching scripts, feedback loops, tool references that the application cannot execute, and
default language such as "your role is diagnostic" or "the writer does the writing."

## Domain Behavior

- `worldbuilding` and `story-sense` become broad creation routers that synthesize coherent setting
  or narrative documents rather than diagnosing story states.
- `systemic-worldbuilding` creates cascading social, political, economic, cultural, and everyday
  consequences from speculative changes.
- `belief-systems`, `economic-systems`, `governance-systems`, and `settlement-design` create
  complete reference entries containing history, internal variation, tensions, lived effects, and
  story-relevant details.
- `character-arc` creates a transformation arc with a starting belief, pressures, decisions,
  costs, and end state.
- `character-naming` creates names and naming systems grounded in culture, language, class, region,
  and generation.
- `dialogue` writes requested dialogue or creates a character voice/dialogue reference without
  explaining technique.
- `scene-sequencing` creates scenes, sequences, or scene plans with causal momentum and controlled
  pacing.
- `prose-style` writes or rewrites prose in the requested voice without explaining stylistic
  choices.
- `endings` creates an ending or ending plan that resolves the requested narrative threads.
- `genre-conventions` creates material that fulfills the selected genre's emotional promise
  without listing conventions in the output.
- `story-idea-generator` creates complete story-concept documents rather than brainstorming
  commentary.
- `cliche-transcendence` silently transforms familiar material and emits only the resulting
  original version.

## Interaction With Preset Modules

No prompt-assembly behavior changes. Enabled custom preset modules retain their configured role,
order, and insertion position. The protected Sources module continues to emit selected sources as
a system message. Attached skills continue to be inserted immediately after Sources at the same
position and normally coalesce with it into one provider-facing system message.

Because custom modules remain user-controlled, they may conflict with a creation skill. Users can
disable or edit those modules. This change does not add a protected application-wide output
contract.

## Attribution

The skills remain MIT-licensed derivatives of `jwynia/agent-skills` at upstream commit
`e02ec7e226a6e4f8419fd3b88a1d8e472d421b32`. `ATTRIBUTION.md` must stop claiming that their bodies
are verbatim and instead identify them as worldbookllm adaptations, summarize the behavioral
rewrite, preserve the upstream paths, and keep the bundled MIT license text.

Documentation in ADR 0011 and the roadmap must likewise describe the starter set as adapted rather
than vendored verbatim. The historical decision and upstream provenance remain intact.

## Verification

Automated tests will read the actual bundled catalog and verify:

- exactly the expected 16 skill directories are present;
- every `SKILL.md` has valid frontmatter and its directory matches its skill name;
- metadata is generative-first;
- every body contains the shared creation/output and explicit-critique contracts;
- default diagnostic identity phrases are absent from the creation instructions; and
- the ordinary starter catalog can still list and install all bundled skills.

Implementation follows test-first development: add the content-contract test, confirm it fails on
the existing diagnostic skills, rewrite the skills, then confirm the focused tests and the full
repository verification gates pass. Required final gates are `pnpm lint`, `pnpm format:check`,
`pnpm typecheck`, `pnpm test`, and `pnpm build`.

## Delivery

The completed change will be committed on a feature branch and opened as a GitHub pull request. It
will not be deployed from this branch. After the user merges the PR and explicitly requests an
update, both local checkouts will be fast-forwarded, the production checkout rebuilt, and the
Termux-hosted server restarted against its existing data directory.
