---
name: choice-design
description: For the discovery beat writer. Use when writing the choices a beat ends with (write_beat, write_choices, or the choice in accept_action), to make each a distinct intent with a real cost, worded so the reader knows what they are doing but not what happens.
---

# Choice design

A good set of choices is a question the reader wants to answer. Each choice is
a different answer to it.

## Intents, not outcomes

- Give every choice a different `intent`: what the reader means by picking it
  (curiosity, duty, refusal, care, deceit). Three ways to be curious are one
  choice, not three.
- No obviously right answer. If one choice is plainly safe and wise, the others
  are not choices. Give the sensible option a cost and the reckless one a
  reason.
- No false choices: two choices that go to the same place and change the same
  things are one choice. If they rejoin the same beat, make them differ in
  `effects` or in what the next beat says because of them.
- Do not offer again what the reader just passed up. If the beat before offered
  a way out and they chose otherwise, offer it again only when something has
  changed it: a new cost, a new reason, a closing window.

## Wording `text`

- Say what the reader does, in the book's voice, as an action: "Slip out
  the back", not "Slipping away" or "What if he left?".
- Keep it short, about eight words or fewer, and never in brackets.
- Tell the reader what they are doing, not what will happen: "Ask the guard
  his name", not "Ask the guard his name and win him over".
- Stay in the person and tense the book uses.

## `consequence` and `note`

- `consequence` is what the choice costs or changes: something given up, a
  door closed, a person affected. "She learns more" is not a cost.
- `note` (for `leads_to: "new"`) is the plan for the beat it leads to: what
  happens there and why it matters. The next beat is written from it, maybe
  much later, so be specific.
- Use `effects` (like `trust += 1`) when a choice should be remembered; see
  memory-and-state.

## Mixing where they lead

- Most choices lead to `new` beats early in a story. As it goes on, lead some
  into `existing` beats (see branch-economy) and, once earned, to `end`.
- A set where every choice opens a new branch grows the book fast. One rejoin
  in a set is often enough to keep it manageable.
