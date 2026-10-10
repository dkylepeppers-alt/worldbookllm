# ADR 0029 — Interactive books get a Branches tab, a map, path checks, and editions

**Status:** accepted · 2026-10-10 · builds on ADR 0027 and ADR 0028

## Context

ADR 0027 and 0028 gave books a choice editor, game state, and an ink Play screen, reached by a link under the Write tab. Interactive books are meant to be a first-class kind of book: findable from the tab bar, readable at a glance as a graph, checked path by path, startable from an existing novel without turning the novel itself into a gamebook, and buildable with the agent.

## Decision

1. **A book is interactive when story.md has an `ifid` or any chapter has `choices`.** Both are story-skills' own fields; no new key is added to story.md. The server reports it as `interactive` on the book summary, with the chapter check made against the file index's stored frontmatter.
2. **Interactive books get a Branches tab** (`/books/:slug/branches`): the story summary, a map of the chapters, and the way into editing choices (`branches/edit`, the ADR 0027 editor) and Play (`branches/play`). The earlier `write/branches` and `write/play` addresses redirect there, keeping their query and hash. Any book reaches the tab's page from Write ("Make it interactive").
3. **The map** lays chapters out top to bottom by the fewest choices from the start, in chapter order within a row, with chapters no path reaches in a last row. Each chapter opens its choices; choices that go back up or loop are drawn around the side; dashed links set or require flags. The same map is offered as a list.
4. **"Make an interactive edition"** copies a linear book's Markdown files into a new book, as story-skills' adaptation skill advises, so the novel's builds and continuity stay linear. The copy gets its own title, leaves any series, and gets a fresh IFID, which makes it interactive. It is reindexed and validated like an imported project. Later changes to either book stay in that book.
5. **Health has a Paths section** for interactive books: story-skills' findings about choices and paths (`invalid-choice`, choices to missing chapters, `unreachable-chapter`, `state-differs-by-path`), and the choice-state problems only worldbookllm can see.
6. **The Agent tab has an Interactive story guide**: plan the branch map (`adaptations/interactive/branch-map.md`), add the choices, draft the branches, add state, check every path. Each step puts a request in the composer. The state step spells out `sets` and `requires`, which story-skills' skills do not describe.

## Consequences

- The tab bar can hold seven tabs on a phone; the label is Branches, short enough to fit.
- An edition is a copy, not a link: fixes to the novel do not flow into the edition. That matches story-skills' adaptation advice and keeps each book's history its own.
- Pinning an IFID on a linear book marks it interactive, which is what pinning one is for.
