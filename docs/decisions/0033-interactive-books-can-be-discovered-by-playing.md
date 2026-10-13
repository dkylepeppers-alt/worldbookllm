# ADR 0033 — Interactive books can be discovered by playing

**Status:** accepted · 2026-10-13 · builds on ADR 0030 and ADR 0032

## Context

An interactive book can be written by hand in ink, or with the agent's plan-first guide (ADR 0029): plan a branch map, add the choices, draft each branch. Many writers discover a story rather than plan it, and interactive fiction suits that well. You read up to a choice, pick one, and find out what happens. story-skills already has a discovery-drafting skill for linear books (a story kernel, `draft-mode: discovered`, chapters with `mode: discovered`). No part of worldbookllm lets a writer build a branching book that way. And a model asked for choices with no rules tends to offer three that are near-identical or that the scene cannot support.

## Decision

1. **Discovery starts with a story setup.** It is stored as `adaptations/interactive/setup.md`, a visible book file. Its flat frontmatter holds:
   - the mode (`lead` or `cowrite`)
   - the look-ahead (1 or 2)
   - the number of choices per beat (2 to 4, default 3)
   - the beat length (`scene` or `chapter`)
   - the endings wanted
   - how often branches rejoin

   Its body holds the shape and tone notes. The premise is story-skills' story kernel (`## Story Kernel` in story.md, with `draft-mode: discovered`). The bible is the book's own.

   The beat writer drafts the premise, the shape and tone, and the endings from the bible and story.md when the setup form first opens, and again whenever the writer asks. It builds on anything the writer has already written, and reads the scenes already written (or the opening scene the writer is typing), so the premise describes the story that is there. The drafts fill the form's fields and nothing is saved until the writer saves the setup, so the writer edits them like their own words. A field the writer changes while a draft is running is left as they typed it.

   The premise is required only when the beat writer writes the opening from it. A book that already has chapters, or whose writer writes the opening scene, can leave it empty. The scenes then tell the beat writer the story, and the premise says where it is going.

2. **State is agreed at setup.** The variables live in `ink/variables.md`. Each `VAR` has a `//` comment line above it that says what it means, and the beat writer reads that comment. The beat writer only uses declared variables. A new one is proposed, and it is declared once the writer approves it.
3. **Choices follow written rules.** The rules are in `adaptations/interactive/choice-rules.md`, which setup writes with the defaults and the writer can edit:
   - different intents, not different wording
   - true to the character
   - possible in the scene, and in what the character knows on this path
   - every choice matters
   - no obvious right answer
   - no spoilers
   - variety across the book
   - in the book's voice

   Three things enforce them:
   - Every choice carries its intent and consequence in the beat's planning notes (`## Choices`, above `## Chapter Text`), so the ink stays editable on the choices screen.
   - Structural checks refuse a set with duplicate text, false choices (two choices to the same place with the same effects), undeclared variables, or ink that does not compile.
   - A review pass checks the set against the rules before anything is written. A set that fails is rewritten.

4. **Unwritten choices lead to seed chapters.** A seed is a real chapter file with `discover: "seed"`, `status: outline` and `mode: discovered`. Its planning section says how it is reached and holds the writer's note. Its ink is a `TODO:` line and `-> END`, so the story always compiles and plays. A written beat has:
   - `discover: "written"`
   - `discover-from`, the chapter it continues
   - `discover-parent`, a hash of that chapter's ink when the beat was written
   - `discover-ink`, a hash of its own ink as written

   An edited beat is one whose ink no longer matches `discover-ink`.

5. **Beats are written by a beat writer, not the chat agent.** It uses the configured provider (tool calling required) with a fixed set of tools: `write_beat`, `propose_variable`, and, for a reader's own action, `decline_action`. Each call gets:
   - the transcript of the path the reader played
   - the variable values at that point
   - every other knot that leads to the beat
   - the bible, the setup and the rules

   Each written beat is its own checkpoint with the actor `agent`, so it can be undone alone.

   The setup may pick a custom agent (the ones chats use, from the Agents page) as the beat writer, stored as `beat-agent` in setup.md. It works as it does in a chat: its instructions are added to the beat writer's prompt as its role, its skills are listed there, and the beat writer loads them with `activate_skill` and `read_skill_file`. The tools, checks and rules for choices stay the same. Saving refuses an agent that no longer exists, and a book whose agent was deleted is written by the default beat writer.

6. **Lead mode writes ahead of the reader.** The Play screen reports where the reader is. The server replays that path and marks the chapters it visits as read; reads are kept in SQLite. It then queues every seed within the look-ahead of the reader's position, nearest first, one book at a time. With the default look-ahead of 1, the beat after every choice the reader can see is always written. A look-ahead of 2 writes the layer after that too.

   Lead mode leaves the writer's own chapters alone, such as those of a book converted to ink, because one that ends without choices may be an ending. When the reader reaches the end of such a chapter, Play offers _Write what happens next_. The beat writer then adds the chapter's closing choices, with a seed for each, and keeps the prose as written. From there discovery goes on as usual.

7. **Edits upstream invalidate beats below them.** When a chapter's ink changes, the beats written from it are stale:
   - A stale beat that is unread and unedited is rewritten.
   - Any other stale beat is listed on Health under _Needs review_ until the writer marks it reviewed, which records the new parent hash. It is never rewritten.
8. **Co-write mode drafts on request.** At a seed, Play offers _Write it yourself_ (the ink editor) or _Draft with the agent_. The second returns three proposals that go in different directions. Nothing is written until the writer picks one.
9. **Every choice point in Play offers a fourth option, _Something else…_.** The reader types an action. The beat writer either:
   - accepts it: the action becomes a real choice on the beat, written in the book's voice, with a new beat after it, and play continues into it; or
   - declines it with a reason and the nearest action that would work.

   _Something else_ exists only in Play while writing. It is never a choice in the ink or in an export.

10. **Rejoins converge before they divert.** A choice may lead to an existing knot. The beat that leads there must first make what differs between paths agree, or carry it in a variable the rejoin reads. The beat writer never edits the knot it rejoins.
11. **Health and the map show open threads.** Health lists open threads (seeds, with the shortest path to each) and _Needs review_. The map draws seeds as open nodes. Exports warn while seeds remain.

## Rationale

Real seed files keep the rule that the book on disk is the book (ADR 0003, ADR 0014). A seed is indexed, checkpointed, visible and editable, and the story compiles without special cases. Placeholders that exist only in the app would make the book a reader plays differ from the files.

A dedicated beat writer with a structured `write_beat` tool can enforce the rules and the file layout. A free-form agent turn can only be asked to follow them.

Read tracking is not book content, so it lives in SQLite. Losing it only makes unedited beats look unread. Edits are detected from the files themselves, so a beat the writer changed is never rewritten.

Look-ahead 1 is the default because each layer multiplies the writing. With three choices, two layers are about nine beats per choice the reader makes, unless branches rejoin.

## Consequences

- Writers can build a branching book with no outline, keep it playable at every step, and fill in the paths they did not take later.
- Lead mode spends model calls in the background while the reader plays. The look-ahead setting and rejoins bound that spending.
- Chapters gain four worldbookllm frontmatter keys (`discover`, `discover-from`, `discover-parent`, `discover-ink`), and books gain two files under `adaptations/interactive/`.
- Rejoins are only as good as the convergence the beat before them writes. Health → Paths (ADR 0032) and _Check every path_ still apply.
