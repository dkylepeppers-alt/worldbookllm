---
name: character-arc
description: Create positive, negative, or flat character arcs with earned changes, consequential choices, and a clear relationship between inner conflict and plot. Use for new arcs or explicit critique.
license: MIT
metadata:
  author: "jwynia; adapted by worldbookllm"
  version: "2.0"
  type: generator
  mode: generative+explicit-critique
  domain: character
---

# Character Arc

Create character transformations that emerge from pressure, choice, consequence, and changed
behavior.

## Creation Mode

Default to creating the requested arc, character entry, sequence of turning points, or narrative
material. Do not grade the character or explain arc theory. Infer an appropriate arc type from the
request unless the user specifies one.

Anchor the arc in five connected elements:

- **Starting condition:** the wound, formative experience, role, or environment that shaped the
  character's current way of living.
- **Governing belief:** the truth, lie, value, or survival rule that determines their choices.
- **Want and need:** what they consciously pursue and what deeper change, commitment, or refusal the
  story tests.
- **Pressure:** escalating events that make the old pattern costly but abandoning it frightening.
- **Proof through choice:** a climax in which behavior, sacrifice, or refusal demonstrates the final
  state.

## Source-Ready Output Contract

Return only the finished document in Markdown. Begin directly with its title or requested narrative
form. Do not include a preamble, explanation, rationale, analysis, citations, provenance, references
to source material, or an offer to revise or continue. Never narrate your process.

If the user requests a scene, monologue, journal entry, or other in-world artifact, write it directly.
Otherwise create a polished arc or character reference with sections appropriate to the request.

## Canon and Ambiguity

Treat available material as invisible canon. Preserve established characterization, relationships,
events, chronology, and tone. Fill ordinary gaps with plausible motives and connective events. If
canon conflicts, or a missing decision would materially change established canon, ask one concise
clarification question and stop without drafting alternatives.

## Arc Forms

### Positive Arc

The character begins constrained by a false or incomplete belief, encounters evidence it cannot
explain away, pays increasing costs for old behavior, risks acting on a harder truth, and finally
makes a choice that embodies change. Preserve scars and habits so growth feels earned, not magical.

### Negative Arc

The character has opportunities to change but interprets pressure through fear, pride, obsession,
or resentment. Each compromise makes the next easier. The final choice embraces a destructive
belief or rejects a truth the character could have accepted.

### Flat Arc

The character already holds a tested truth or value. External pressure challenges their ability to
live by it. Their steadfast choices change other people or the surrounding system, but steadfastness
must still cost them something.

## Silent Synthesis Process

Silently connect each major plot turn to an internal movement: reinforcement, doubt, experimentation,
relapse, commitment, or consequence. Make relationships carry competing visions of who the
character is. Ensure the climax resolves both an external problem and an internal decision without
requiring a speech that explains the lesson.

## Explicit Critique Mode

Activate critique only when the user explicitly asks to critique, assess, diagnose, review, or
troubleshoot an existing arc. Then trace belief, pressure, choices, reversals, costs, and end-state
behavior; identify missing causal links; and recommend the smallest high-impact revisions. Do not
critique merely because a draft or character profile was supplied.
