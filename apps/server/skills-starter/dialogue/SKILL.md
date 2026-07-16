---
name: dialogue
description: Write dialogue and voice references with distinct speakers, competing objectives, subtext, relationship movement, and purposeful silence. Use for creation, rewriting, or explicit critique.
license: MIT
metadata:
  author: "jwynia; adapted by worldbookllm"
  version: "2.0"
  type: generator
  mode: generative+explicit-critique
  domain: fiction
---

# Dialogue

Write conversations in which every speaker wants something and the exchange changes what is possible
between them.

## Creation Mode

Default to writing the requested dialogue, scene, transcript, voice guide, or character speech
material. Do not explain dialogue technique or annotate the result. When rewriting supplied
dialogue, return the complete rewritten passage unless the user asks for a different form.

Build each exchange around simultaneous functions:

- a concrete objective for every active speaker;
- information each speaker reveals, withholds, misdirects, or misunderstands;
- a relationship and power balance that shifts beat by beat;
- distinct vocabulary, syntax, rhythm, directness, metaphor, and conversational habits;
- physical action, setting pressure, and silence where they carry meaning; and
- an outcome that advances plot, alters trust, creates obligation, or sharpens conflict.

## Source-Ready Output Contract

Return only the finished document in Markdown. Begin directly with the dialogue, scene title, or
requested voice reference. Do not include a preamble, explanation, rationale, analysis, citations,
provenance, references to source material, craft notes, or an offer to revise or continue. Do not
label subtext or explain what a line accomplishes.

Follow the requested format. Prose scenes use natural action beats; scripts use the requested script
conventions; transcripts or in-world records retain their documentary form.

## Canon and Ambiguity

Treat available material as invisible canon. Preserve established voice, knowledge, relationships,
status, setting, chronology, and emotional continuity. Do not let a character reveal information
they cannot know. Fill ordinary gaps with plausible intent and behavior. If canon conflicts, or a
missing decision would materially change established canon, ask one concise clarification question
and stop without drafting the exchange.

## Dialogue Construction

Silently determine what each speaker wants before the conversation, what they refuse to say, and
what tactic they begin with. Let tactics change when they fail: charm may become pressure, evasion
may become counterattack, or formality may fracture into intimacy.

Favor implication over mutual exposition. People answer selectively, pursue their own trains of
thought, protect face, misread cues, and use shared history without restating it. Distinct voices
come from worldview and social experience, not catchphrases or exaggerated accents.

Use action beats only when they reveal attention, avoidance, control, vulnerability, or interaction
with the environment. Give silence a consequence. End when the dramatic value has changed, not after
both parties summarize the conversation.

## Silent Completeness Check

Before answering, silently read the dialogue for speaker distinction, redundant greetings,
on-the-nose emotion, disguised exposition, static power, repeated beats, and lines that perform no
function. Revise silently and emit only the finished result.

## Explicit Critique Mode

Activate critique only when the user explicitly asks to critique, assess, diagnose, review, or
troubleshoot existing dialogue. Then examine objectives, subtext, voice distinction, exposition,
power shifts, action beats, and scene outcome. Quote only what is necessary to locate a problem and
offer concrete revisions. Never critique merely because dialogue was supplied for expansion or
rewriting.
