---
name: cliche-transcendence
description: Transform familiar premises, characters, institutions, conflicts, and setting elements into specific original material while preserving their useful narrative function. Use for creation or explicit critique.
license: MIT
metadata:
  author: "jwynia; adapted by worldbookllm"
  version: "2.0"
  type: generator
  mode: generative+explicit-critique
  domain: fiction
---

# Cliche Transcendence

Create fresh material by preserving what a familiar element accomplishes while changing the
assumptions that make its usual expression predictable.

## Creation Mode

Default to transforming the requested element and outputting the finished replacement or expansion.
Do not label the original a cliche, describe the transformation, list options, or explain why the
new version is more original unless the user explicitly requests analysis.

Silently apply this sequence:

1. Identify the element's narrative function: threat, belonging, wonder, temptation, obstruction,
   status, mystery, intimacy, or another effect.
2. Identify the most predictable assumptions surrounding its usual form.
3. Preserve the function while changing at least two independent dimensions, such as social role,
   cost, scale, beneficiary, material basis, history, aesthetic, or moral alignment.
4. Trace consequences so the transformation affects institutions, behavior, language, and daily
   life rather than remaining a cosmetic inversion.
5. Reconnect the result to specific characters, factions, places, and pressures in canon.

## Source-Ready Output Contract

Return only the finished document in Markdown. Begin directly with its title or requested in-world
form. Do not include a preamble, explanation, rationale, analysis, citations, provenance, references
to source material, comparisons with the original, or an offer to revise or continue. Never expose
the transformation checklist in the response.

## Canon and Ambiguity

Treat available material as invisible canon. Preserve the established function, tone, names,
chronology, and constraints while making the requested material more particular. Fill ordinary gaps
with coherent invention. If canon conflicts, or a missing decision would materially change
established canon, ask one concise clarification question and stop without drafting variants.

## Transformation Levers

- **Orthogonal detail:** combine traits that do not normally travel together but arise from the
  setting's logic.
- **Shifted beneficiary:** ask who gains from the familiar arrangement besides the obvious winner.
- **Reversed cost:** move the burden to a different class, place, generation, institution, or body.
- **Historical residue:** make the element an adaptation to an old crisis rather than a timeless
  genre fixture.
- **Internal diversity:** replace a monolith with factions that disagree for intelligible reasons.
- **Material constraint:** ground symbols and customs in ecology, labor, infrastructure, or scarcity.
- **Second-order effect:** let people reorganize around the element and then react to that
  reorganization.

Avoid novelty through randomness. The transformed element must remain legible, useful to the story,
and causally embedded in the world.

## Silent Completeness Check

Before answering, silently confirm that the result retains the requested emotional or narrative
function, cannot be reduced to a one-line reversal, creates consequences beyond the protagonist,
and uses details particular to this canon rather than generically unusual decoration.

## Explicit Critique Mode

Activate critique only when the user explicitly asks to critique, assess, diagnose, review, or
troubleshoot existing material. Then identify predictable assumptions, distinguish functional genre
conventions from disposable defaults, and recommend transformations that preserve the element's
purpose. Do not critique merely because a familiar trope appears in supplied material.
