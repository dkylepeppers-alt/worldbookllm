---
name: skill-creator
description: Author a new worldbookllm skill. Produce a complete, source-ready SKILL.md that follows the generative-first contract — creation by default, finished Markdown output, canon-aware, critique gated. Use to draft a skill from a described craft or workflow, or to revise an existing one.
license: MIT
metadata:
  author: "worldbookllm"
  version: "1.0"
  type: authoring
  mode: authoring
  domain: meta
---

# Skill Creator

Turn a described craft, workflow, or facilitation practice into a ready-to-install worldbookllm skill.
A skill is a single `SKILL.md` file whose instructions are injected into the model's system prompt when
a user attaches it to a chat; it cannot execute code, so everything it does must live in its prose.

## Authoring Mode

Default to producing the finished `SKILL.md`. Infer the skill's **kind** from the request and shape the
body accordingly:

- **generative** — creates source-ready creative material from canon (the common case). Use
  `metadata.mode: generative+explicit-critique`.
- **interactive** — runs a live, turn-by-turn experience such as a game or interview. Use
  `metadata.mode: interactive`.
- **authoring** — produces a document or artifact for the user to keep, rather than story canon. Use
  `metadata.mode: authoring`.

Silently choose a lowercase-hyphenated `name` that matches the intended directory, write a description
that states what the skill produces and when to use it, and select the kind before drafting the body.

## SKILL.md Contract

Emit agentskills.io-compatible frontmatter followed by the body:

- Frontmatter keys: `name` (lowercase letters, numbers, single hyphens; ≤ 64 chars), `description`
  (a single trimmed line, ≤ 1024 chars), `license`, and a `metadata` block with `author`, `version`,
  `type`, `mode`, and `domain`.
- A generative skill's body carries `## Creation Mode`, `## Source-Ready Output Contract`,
  `## Canon and Ambiguity`, and `## Explicit Critique Mode`, plus any domain sections it needs.
- An interactive skill's body carries `## Facilitation Mode`, `## Session Contract`,
  `## Canon and Continuity`, and `## Explicit Critique Mode`.
- An authoring skill's body carries `## Authoring Mode`, an output-shape section, `## Output Contract`,
  and `## Explicit Critique Mode`.

Whatever the kind, encode the shared worldbookllm contract: creation is the default, the response is
finished Markdown rather than advice, it begins directly with the content, selected sources are treated
as invisible canon, ordinary gaps are filled by invention while material conflicts trigger one
clarifying question, and diagnostic or critique behavior is gated behind an explicit request.

## Output Contract

Return only the finished `SKILL.md` — frontmatter and body — with no preamble, no explanation of your
choices, no rationale, and no offer to revise. Do not describe the skill you are writing; write it.

## Canon and Ambiguity

Treat any supplied skills, notes, or examples as invisible canon for house style and conventions. If the
skill's kind, domain, or default behavior is unspecified and a reasonable default would materially change
the file, ask one concise clarification question and stop rather than drafting several variants.

## Explicit Critique Mode

Activate critique only when the user explicitly asks to review, assess, or troubleshoot an existing
skill. Then evaluate whether the description will trigger the skill at the right times, whether the body
states a complete and unambiguous contract, and whether it honors the generative-first rules; name the
largest gap with its evidence and recommend one prioritized fix. Do not critique merely because a draft
is incomplete.
