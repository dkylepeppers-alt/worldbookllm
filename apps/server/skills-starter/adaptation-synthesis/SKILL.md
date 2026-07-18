---
name: adaptation-synthesis
description: Adapt an existing work, or fuse several sources, into new source-ready material that preserves each original's narrative function while changing its form. Use to translate a premise, character, or structure into a new setting or genre, or to combine influences into one coherent work.
license: MIT
metadata:
  author: "jwynia; adapted by worldbookllm"
  version: "1.0"
  type: generator
  mode: generative+explicit-critique
  domain: fiction
---

# Adaptation Synthesis

Create new material that serves the functions of a source work through forms native to a new context.
Successful adaptation preserves what made the original work; failed adaptation copies surface elements
and loses their effect.

## Creation Mode

Default to producing the adapted material. Do not label the source, describe the mapping, list options,
or explain why the new version works unless the user explicitly requests analysis.

Silently apply this sequence:

1. Identify what each borrowed element _accomplishes_: the pressure, relationship, wonder, threat,
   temptation, or reversal it supplies to the story.
2. Establish the target context and genre from the request and canon.
3. Generate a form native to the new context that produces the same pressure through its own internal
   logic, rather than translating the original form one-to-one.
4. When combining several sources, choose one as the structural backbone, blend functions that
   reinforce each other, and resolve contradictions in the backbone's favor or by making the tension a
   feature of the new work.
5. Reconnect every borrowed function to specific characters, factions, places, and stakes in canon.

## Source-Ready Output Contract

Return only the finished adapted document in Markdown. Begin directly with its title or requested
in-world form. Do not include a preamble, a mapping table, phrases such as "this corresponds to,"
provenance, references to the source material, comparisons with the original, or an offer to revise or
continue. Never expose the function-to-form worksheet in the response.

## Canon and Ambiguity

Treat selected sources as both the material being adapted and invisible canon: preserve their essential
functions, tone, and internal logic while changing surface form. Fill ordinary gaps with coherent
invention. If the target context or genre is unspecified and would materially change the result, or if
canon conflicts with the adaptation, ask one concise clarification question and stop without drafting
variants.

## Orthogonality

Every adapted element must know what story it is now in. Before committing a form, silently confirm it
would read as natural to someone who has never met the source: it exists for its own reasons, carries
its own goals and history, and could be narrated without ever mentioning the original. A compliance
officer who uncovers corporate wrongdoing can serve a whistle-blowing prince's function without being a
prince in a suit. Reject any element whose only justification is that the source demands it. For deeper
transformation of a single familiar element, defer to the `cliche-transcendence` skill.

## Function-to-Form

Ask "what in this context naturally creates the required pressure?" rather than "what is the new
version of X?" Map each primary function to a context-native form, apply the orthogonality check,
verify the adapted material keeps the original's emotional promise and genre (a tragedy must not drift
into an adventure), and only then resolve any remaining multi-source conflicts. Voice and tone follow
the same rule: characters speak from their new world, not in the cadence of the originals.

## Silent Completeness Check

Before answering, silently confirm the result serves every essential function of the source, cannot be
reduced to a surface swap ("[original] but in [setting]"), keeps the original emotional experience
intact, creates consequences beyond the protagonist, and uses details particular to this canon.

## Explicit Critique Mode

Activate critique only when the user explicitly asks to critique, assess, diagnose, review, or
troubleshoot an existing adaptation. Then name the largest failure — surface swap, missing function,
tone or genre drift, or forced fit where the context cannot support a borrowed element — explain the
evidence, and recommend the transformation that restores the source's function. Do not critique merely
because supplied material resembles a known work.
