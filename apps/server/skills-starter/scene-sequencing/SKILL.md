---
name: scene-sequencing
description: Create scenes and scene sequences with clear goals, escalating conflict, consequential outcomes, reaction, decisions, causal transitions, and controlled pacing. Use for creation or explicit critique.
license: MIT
metadata:
  author: "jwynia; adapted by worldbookllm"
  version: "2.0"
  type: generator
  mode: generative+explicit-critique
  domain: fiction
---

# Scene Sequencing

Create narrative movement in which each scene changes the conditions of the next.

## Creation Mode

Default to writing the requested scene, sequence, chapter plan, beat sheet, or pacing expansion.
Produce the finished narrative material or usable story document, not an assessment of what is
missing.

Use two complementary movements where appropriate:

- **Action:** a viewpoint character pursues a specific goal, encounters escalating conflict, and
  reaches an outcome that changes the situation.
- **Response:** the character absorbs the outcome, confronts a dilemma, and makes a decision that
  produces the next goal.

These movements may occupy whole scenes, brief beats, or overlap under pressure. Preserve their
causal function rather than applying a rigid alternating formula.

## Source-Ready Output Contract

Return only the finished document in Markdown. Begin directly with the scene, sequence title, or
requested plan. Do not include a preamble, explanation, rationale, analysis, citations, provenance,
references to source material, craft commentary, or an offer to revise or continue. Do not label
structural beats inside prose unless the user requests an outline.

## Canon and Ambiguity

Treat available material as invisible canon. Preserve established events, geography, travel time,
character knowledge, abilities, relationships, and chronology. Fill ordinary gaps with plausible
causal links. If canon conflicts, or a missing decision would materially change established canon,
ask one concise clarification question and stop without drafting alternate sequences.

## Sequence Construction

For every scene, silently establish the viewpoint, immediate goal, obstacle, stakes, available
tactics, turning point, and changed outcome. Begin near the point where pursuit becomes active and
leave after the consequence or decision has created forward pressure.

Escalate by changing the problem, cost, information, relationship, or available choices—not merely
by increasing volume. Favor outcomes such as “yes, but,” “no, and,” or costly success when they arise
naturally. Simple success is valid when it closes a thread or creates contrast, but should still
change the story state.

Control pace through selection. Compress repeated attempts, routine travel, and foregone decisions.
Expand irreversible choices, reversals, discoveries, emotional consequences, and moments where the
reader must understand a new possibility. Let quieter response beats generate decisions rather than
stalling indefinitely.

## Silent Completeness Check

Before answering, silently verify that goals appear early enough to orient the reader, obstacles
force adaptation, outcomes arise from the conflict, response leads to choice, transitions are
causal, and each scene earns its space by changing knowledge, power, relationship, location, or
commitment.

## Explicit Critique Mode

Activate critique only when the user explicitly asks to critique, assess, diagnose, review, or
troubleshoot existing scenes or pacing. Then trace goals, conflict, outcomes, reaction, decisions,
causal transitions, compression, and expansion. Recommend specific cuts, moves, or missing beats.
Do not critique merely because a sequence was supplied for continuation.
