---
name: story-idea-generator
description: Create complete story concepts whose characters, setting, conflict, stakes, and transformation deliver a deliberate emotional and genre promise. Use for generation or explicit critique.
license: MIT
metadata:
  author: "jwynia; adapted by worldbookllm"
  version: "2.0"
  type: generator
  mode: generative+explicit-critique
  domain: fiction
---

# Story Idea Generator

Create story concepts by deciding what the audience should feel and building a specific causal
engine that can deliver that experience.

## Creation Mode

Default to creating the requested premise, pitch, synopsis, story seed, narrative framework, or
concept expansion. Produce a complete concept document, not a brainstorming conversation, option
list, or assessment of the user's idea unless those forms are explicitly requested.

Connect these elements:

1. **Emotional promise:** the dominant experience and its progression.
2. **Story question:** the uncertainty that can sustain the narrative.
3. **Protagonist:** a person specifically vulnerable to and capable of affecting this conflict.
4. **Desire and stakes:** what they pursue, why it matters, and what worsens if they fail or succeed
   badly.
5. **Opposition:** agents, systems, environments, relationships, or inner commitments with their own
   logic.
6. **Setting engine:** world conditions that repeatedly generate hard choices rather than decorate
   the premise.
7. **Escalation and transformation:** how attempts change the problem and force a decisive end-state.

## Source-Ready Output Contract

Return only the finished document in Markdown. Begin directly with its title or requested format.
Do not include a preamble, explanation, rationale, analysis, citations, provenance, references to
source material, brainstorming commentary, or an offer to generate more. Never explain how the
concept was derived.

Use the requested form. A pitch should read as a pitch; a synopsis should present the actual story;
a reference entry may use concise sections. Do not add multiple alternate concepts unless the user
asks for alternatives.

## Canon and Ambiguity

Treat available material as invisible canon. Preserve established world rules, characters,
chronology, conflicts, and tone. Fill ordinary gaps with inventions that activate existing material.
If canon conflicts, or a missing decision would materially change established canon, ask one concise
clarification question and stop without drafting candidate premises.

## Concept Development

Silently choose a primary genre promise and let secondary genres serve it. Create a protagonist whose
specific history, role, needs, and relationships make this story unavoidable for them. Give
opposition a goal and rationale independent of obstructing the protagonist.

Build an engine capable of producing more than an opening image: recurring pressures, changing
resources, revelations, alliances, and consequences. Make escalation transform the choices rather
than repeat the same conflict at larger scale. End the concept with a decision or confrontation that
answers the story question and changes the protagonist or their world.

Seek originality through specificity, causal combinations, and consequences. A familiar high-level
premise can become distinctive when its institutions, costs, relationships, and viewpoint belong
only to this canon.

## Silent Completeness Check

Before answering, silently verify protagonist fit, active opposition, causal escalation, setting
relevance, stakes, genre promise, thematic tension, and an ending direction. Remove generic labels
that are not supported by concrete story material.

## Explicit Critique Mode

Activate critique only when the user explicitly asks to critique, assess, diagnose, review, or
troubleshoot an existing concept. Then examine emotional promise, character fit, opposition, story
engine, escalation, stakes, specificity, and ending potential. Recommend focused changes without
defaulting to critique merely because a premise was supplied.
