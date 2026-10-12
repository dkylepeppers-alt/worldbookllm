# ADR 0032 — Paths are checked by playing the story

**Status:** accepted · 2026-10-12 · builds on ADR 0030

## Context

The compiler and the structure read from the parse tree (ADR 0030) say what the source says: a divert to a knot that does not exist, a knot nothing diverts to. They cannot say what happens when the story is played. A chapter can compile and still run out of content on one path but not another. A choice can be written and diverted to, yet its condition never holds. A knot can be diverted to only from a choice that is never offered. Variables, visit counts and sticky choices decide all of this. Static analysis would have to reimplement ink's runtime to see it, and it would still be wrong about functions and lists.

## Decision

1. The server plays the compiled story with inkle's runtime (`apps/server/src/story/interactive/explore.ts`). It works breadth first from the start, takes every choice at every stop, and records:
   - runtime errors, with the choice indexes from the start that reach each one
   - how many distinct ending states it reaches, and the fewest and most choices to one
   - knots and stitches no path visits
   - choices no path offers, matched to the runtime by each choice's exact source path rather than its text, so two choices with the same words are told apart
2. Exploration is over distinct states. A state's key is:
   - its variables
   - the random generator's seed and position, since the same state after a different number of `RANDOM()` calls plays on differently
   - visit counts, capped one above the largest number the story is written with (at least 3, at most 100)
   - each flow's callstack frames and position
   - the choices it offers (their source path and text)

   Turn counters, output, thread indexes and the thread counter grow on every loop, so they are left out, and a loop back to a state seen before is recognised.

3. A budget of 3000 states and 2 seconds bounds the work. The time budget holds inside a passage too, so a passage that loops without offering a choice still stops. A report that hit the budget says so (`complete: false`). The UI and the agent then call it partial, never "no problems", and call what it did not see "not reached in the states played" rather than unreachable.
4. The seed is 1, as in Play and the agent's `ink_play`, so every path found replays exactly.
5. The report is served at `GET /api/books/:book/paths` and cached per state of the book. Health shows it under Paths, and each error links to Play at its choices. The agent gets the same report from `ink_paths`.

## Rationale

The runtime is the truth about what a reader can reach. Playing it costs little for the books this app is for, which have tens of chapters and a few variables. Breadth first finds the shortest path to each error, which is the easiest one to reproduce. Visit counts must be capped, or every loop would make new states forever. The story can only tell counts apart by comparing them with numbers it is written with: a condition such as `{cellar > 4}`, or a sequence's length. So capping one above the largest of those keeps apart every state the story treats differently. Arithmetic on counts (`cellar % 2`) is the exception, and it is rare.

## Consequences

- Dead ends, unreachable branches and conditions that can never hold show up without anyone playtesting by hand.
- A story with counters that grow without limit (a variable incremented in a loop) never repeats a state, so its report is partial. The UI says so.
- Each report takes up to 2 seconds of server time for a book that changed. Unchanged books are served from the cache.
