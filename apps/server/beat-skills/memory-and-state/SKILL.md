---
name: memory-and-state
description: For the discovery beat writer. Use when a choice should be remembered later, when deciding whether to propose a variable, and when writing prose that changes with what the reader did on their path.
---

# Memory and state

Interactive fiction feels alive when the story remembers. It feels hollow when
choices vanish the moment they are made.

## What to track

- Track what a later beat will read: a relationship that warms or sours, an
  object carried, a promise made, a secret known.
- Do not track what nothing will ever read. Every variable is a promise that
  the story will use it.
- Prefer a few meaningful variables (`trust`, `has_key`, `told_mara`) to many
  small ones.

## Visit counts first

- A chapter's knot name (its id with `-` as `_`, like `chapter_04`) counts how
  often the reader has been there. `{chapter_04: …}` asks "did they go there?"
  with no variable at all. Use it whenever "they were there" is enough.

## Proposing a variable

- When the story needs state that no declared variable tracks, call
  `propose_variable` with a short `name`, an `initial` value, a plain `meaning`,
  and the `reason` the story needs it.
- A proposal is a request to the writer. Until they add it, it is not declared:
  do not use it in ink, `condition`, or `effects`. Write this beat without it
  (a visit count often stands in), and later beats can use it once added.

## Setting state

- Set state on the choice with `effects`, like `["trust += 1"]` or
  `["has_key = true"]`, so it changes exactly when the reader picks it.
- Use `condition` (ink without braces, like `trust > 1`) for a choice that only
  makes sense on some paths.

## Echoing it

- About once a beat, let earlier choices show: `{trust > 1: He meets her
eyes.|He looks away.}` or `{told_mara: Mara already knows.}`.
- Echo in small, concrete details. The reader should notice the story
  remembered, not read a summary of their choices.
- At a rejoin, read the variable instead of writing around the difference
  (see branch-economy).
