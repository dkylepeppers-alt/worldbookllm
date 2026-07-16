---
name: prose-style
description: Write or rewrite prose with intentional point of view, diction, imagery, rhythm, sensory focus, and narrative distance while preserving the requested voice. Use for creation or explicit critique.
license: MIT
metadata:
  author: "jwynia; adapted by worldbookllm"
  version: "2.0"
  type: generator
  mode: generative+explicit-critique
  domain: fiction
---

# Prose Style

Write prose whose sentence-level choices serve viewpoint, action, atmosphere, character, and meaning.

## Creation Mode

Default to writing or rewriting the requested prose. Return a complete polished passage, scene,
description, voice sample, or style reference. Do not annotate sentence choices, discuss rules, or
explain how the style was achieved.

Silently establish:

- point of view, narrative distance, and what the viewpoint consciousness notices;
- vocabulary shaped by period, culture, education, profession, mood, and personality;
- sentence rhythm appropriate to the pace and emotional pressure;
- concrete nouns and active verbs strong enough to limit modifiers;
- sensory detail selected for significance rather than coverage;
- imagery arising from the viewpoint and world instead of generic poetic language; and
- patterns worth repeating, varying, or breaking for emphasis.

## Source-Ready Output Contract

Return only the finished document in Markdown. Begin directly with the prose, title, or requested
style reference. Do not include a preamble, explanation, rationale, analysis, citations, provenance,
references to source material, revision notes, or an offer to revise or continue. Do not append a
summary of stylistic choices.

Honor any requested length, person, tense, format, register, and degree of stylization. When asked to
rewrite, preserve intended facts and dramatic function unless the user requests substantive change.

## Canon and Ambiguity

Treat available material as invisible canon. Preserve established voice, terminology, facts,
character knowledge, setting rules, chronology, and tone. Fill ordinary connective gaps without
inventing disruptive facts. If canon conflicts, or a missing decision would materially change
established canon, ask one concise clarification question and stop without drafting variants.

## Style Principles

Choose clarity or difficulty intentionally. Vary sentence length according to thought and action,
not to avoid repetition mechanically. Keep description attached to attention and consequence. Let
syntax express control, panic, fatigue, intimacy, formality, or obsession without reducing voice to
a gimmick.

Prefer specific images over adjective stacks, and embodied perception over abstract emotional
labels when the form permits. Use passive voice, fragments, repetition, unusual diction, and
ornament deliberately when they produce the requested effect. Preserve useful strangeness; do not
normalize every voice into neutral contemporary prose.

For a style reference rather than narrative prose, create a usable source document containing the
voice's positive rules, characteristic patterns, boundaries, and short original examples without
meta-commentary about the generation process.

## Silent Completeness Check

Before answering, silently read for viewpoint drift, generic phrasing, filter words, redundant
modifiers, accidental repetition, monotonous rhythm, mixed metaphors, exposition outside the
viewpoint's attention, and decorative lines that interrupt the scene. Revise silently and emit only
the finished text.

## Explicit Critique Mode

Activate critique only when the user explicitly asks to critique, assess, diagnose, review, or
troubleshoot existing prose. Then examine viewpoint, diction, clarity, specificity, rhythm, imagery,
narrative distance, and voice consistency. Use selective examples and concrete revisions. Never
critique merely because prose was provided for continuation or rewriting.
