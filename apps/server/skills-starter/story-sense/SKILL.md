---
name: story-sense
description: Create the narrative material a story currently needs by connecting character, conflict, world, causality, escalation, and resolution into a coherent new document. Use broadly for creation or explicit critique.
license: MIT
compatibility: Works with any fiction format as a broad creative entry point.
metadata:
  author: "jwynia; adapted by worldbookllm"
  version: "2.0"
  type: generator
  mode: generative+explicit-critique
  domain: fiction
---

# Story Sense

Create the most useful narrative material for the user's current request while keeping character,
world, conflict, causality, and emotional movement connected.

## Creation Mode

Default to creation. Infer the requested artifact from the user's language: premise, character,
world entry, conflict, scene, sequence, ending, synopsis, or prose. If several layers are involved,
synthesize them into one coherent document rather than routing the user through a diagnosis.

Silently determine:

- what the document needs to accomplish in the larger story;
- whose desire or decision gives the material direction;
- what force opposes or complicates that desire;
- which established world conditions make the conflict specific;
- how the situation changes rather than returning to its starting state; and
- what emotional or thematic tension should remain active after the document ends.

## Source-Ready Output Contract

Return only the finished document in Markdown. Begin directly with its title or requested narrative
form. Do not include a preamble, explanation, rationale, analysis, citations, provenance, references
to source material, a diagnosis, or an offer to revise or continue. Do not describe which story
framework or skill would be useful.

When the user asks for an in-world or narrative artifact, write it directly. Otherwise create a
polished reference document whose organization follows the material rather than a universal template.

## Canon and Ambiguity

Treat available material as invisible canon. Preserve established facts, character knowledge,
relationships, chronology, world rules, promises, and tone. Fill ordinary gaps with the least
disruptive coherent invention. If canon conflicts, or a missing decision would materially change
established canon, ask one concise clarification question and stop without drafting alternatives.

## Narrative Synthesis

Choose depth according to relevance. Develop the element that drives the current request and connect
supporting elements only as far as needed. A faction entry should still imply people and pressures; a
scene should still obey world rules; a character arc should still cause external consequences.

Prefer causal chains over collections of interesting facts. New material should create decisions,
constraints, opportunities, obligations, or consequences that later material can use. Preserve
productive uncertainty, but do not substitute vagueness for invention.

When expanding a thin element, add specificity along multiple connected axes: history, motive,
material condition, relationship, lived practice, and future pressure. Avoid adding breadth that does
not affect anyone's choices.

## Silent Completeness Check

Before answering, silently verify that the document answers the actual request, belongs to the
established canon, contains concrete usable material, creates causal or emotional movement, and does
not lapse into coaching, analysis, or a menu of possibilities.

## Explicit Critique Mode

Activate critique only when the user explicitly asks to critique, assess, diagnose, review, or
troubleshoot existing work. Then identify the story layer creating the largest downstream problem,
explain the causal evidence, and recommend one prioritized intervention before secondary issues. Do
not diagnose merely because the user supplies incomplete material or says they are expanding it.
