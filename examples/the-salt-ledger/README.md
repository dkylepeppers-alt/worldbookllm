# The Salt Ledger — a worked example

An interactive mystery made end to end in worldbookllm with Kimi K2.6 (NanoGPT), for building a tutorial from. Everything here was produced through the app's own UI.

## What's here

- `source-chapter.md` — the one chapter imported to start the book ("The Margery Lane", about 1,660 words, written by hand).
- `book/` — the whole book as the app keeps it on disk: the bible (`characters/`, `worldbuilding/`, `continuity/`, `scenes/`), the chapters written in ink, the discovery setup and choice rules (`adaptations/interactive/`), and the variables (`ink/variables.md`).
- `the-salt-ledger.html` — the web player export. Open it in a browser to play. (The book's own `dist/` is not committed.)
- `screenshots/` — the run, step by step, numbered in order.

To open the book in the app, copy `book/` to `data/projects/the-salt-ledger/` and start the server.

## How it was made

| Step | Screenshots |
|---|---|
| Configure NanoGPT and the model in Settings | 01–02 |
| Import the chapter as a new book; review title, form, point of view, tense, synopsis | 03–06 |
| Agent tab: install Story Skills, then the guided Build the bible steps (cast and world, chapter scenes, threads, check and fix), answering the agent's questions | 08–21 |
| Bible and Health after the bible was built | 22–23 |
| Branches: Make it interactive (convert to ink) | 24–26 |
| Discovery setup: drafted premise, shape, endings; Lead mode; the Beat writer agent; suggested variables | 27–31 |
| Play: Write what happens next, then playing while the beat writer writes ahead | 32–37, 39–41, 43–53 |
| A failed beat and Try again | 38 |
| Something else: the reader's own action, accepted | 42 |
| Editing the rules for choices | 47 |
| Rewrite with a direction, turning a beat into the ending | 54 |
| The map and Health → Paths | 55–56 |

## The book

- 140 chapters, 136 choices, 7 variables; the longest path is 17 beats deep.
- 46 chapters are written: the imported chapter and 45 discovered beats. The other 94 are open threads (seeds): branches the beat writer has not written yet, whose chapter is a `TODO` that ends the story. The export warns about them, and in the web player most routes stop at one.
- One written ending: "The Succession", where Wren takes Varga's heron ring and sits down at the tithe desk.
- Health → Paths plays every path without runtime errors; it counts seeds as open threads, not as finished endings.

Known rough edges, left as found:

- Twelve chapters after "The Succession" (`chapter-129` to `chapter-140`) are unreachable: rewriting that beat into an ending stranded the beats already written after it. Health lists them under No path reaches. The app now refuses that rewrite (PR #106).
- Some phrases recur across beats (the harbor bell "counting an hour she had lost track of").
- Endings needed a direction: the beat writer did not end a path on its own (see PR #106 for the pacing change).
