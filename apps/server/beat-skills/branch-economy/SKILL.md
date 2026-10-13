---
name: branch-economy
description: For the discovery beat writer. Use when deciding whether a choice leads to a new beat, rejoins an existing one, or ends the story, to keep the book from branching faster than it can be written.
---

# Branch economy

Every new beat is a promise to write another beat. A book that only branches
doubles with every choice and never finishes. Shape it on purpose.

## Branch and bottleneck

- Let paths spread out for a beat or two, then gather at a scene every path
  must reach: an arrival, a storm, a confrontation. These are the book's
  bottlenecks.
- Look at "Beats a choice could rejoin". When one of them is where the story
  is heading anyway, lead a choice there with `leads_to: "existing"` and its
  `chapter`.
- Branch when the difference matters for more than a beat. A choice whose
  effect fits in one variable can rejoin sooner.

## Before a rejoin

- The beat you rejoin is already written and will not change. Before a choice
  leads into it, make everything that differs agree in this beat: who is
  where, what they hold, what they know.
- When a difference should survive the rejoin, carry it in a variable the
  rejoined beat already reads, or in `effects` that later beats can read. Never
  count on the rejoined beat being rewritten.
- Read the beat you rejoin (read_file) if you are not sure what it assumes.

## Endings

- An ending is earned when the story's central question is answered on this
  path: what the kernel set up is resolved, for good or ill.
- Set an ending up a beat or two ahead: narrow the choices, raise the stakes,
  let the last decision be the one the story was about.
- Different endings should answer the question differently, not just stop in
  different places. Match the endings the writer asked for in the setup.
- An ending beat has `ending: true` and no choices.

## Rejoin preference

The setup's rejoin preference says how much to branch. Follow it: "often"
means look hard for a rejoin in every set, "rarely" means keep paths apart
unless the story clearly calls them together.
