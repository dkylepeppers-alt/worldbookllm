# Product

## Register

product

## Platform

web — mobile-first (phone is the primary form factor), scaling to tablet and desktop

## Users

Novelists, serial and short-fiction writers, worldbuilders, and game masters building a book or series. They want an AI collaborator that knows the whole project (cast, world, plot threads, what each character knows at each chapter) and that keeps canon consistent instead of inventing over it. They work in short sessions, often on a phone, and they want to own their files.

## Product Purpose

worldbookllm is a local-first, model-agnostic workspace for [story-skills](https://github.com/danjdewhurst/story-skills) projects. A book is a directory of plain Markdown with one file per character, place, arc, chapter, scene, and continuity thread. The `story` CLI keeps that structure valid and checks continuity. An agent runs the story-skills craft skills against the project: it plans, drafts, revises, and checks, and every change it makes is shown as a diff the writer can undo. Research and lore come in through the ingestion pipeline as research notes. Series share a series bible so canon stays consistent from book to book. Success is the writer trusting both the canon and the tool: every file stays readable and editable, and every change can be seen and reversed.

## Positioning

A story-skills workspace in your pocket: the whole book bible, the manuscript, continuity checks, and an agent that follows real craft skills, with a model you choose and files you own.

## Brand Personality

A quiet, capable writing tool. Calm and neutral, like a good editor: the interface is clear and unadorned so the writer's words — set in a serif — carry the voice. Plain language in the UI ("Loading books…", "Something went wrong"), no themed metaphors. Confident and unfussy; it respects the writer's time and files.

## Anti-references

Not a generic SaaS dashboard — no card grids of hero metrics, gradient text, or marketing chrome. Not a stock AI chatbot skin either — the agent is one tab among several, never the dominant element that pushes the manuscript and bible into the background. Not a themed or skeuomorphic object (paper textures, maps, leather, typewriters); the look comes from type, spacing, and restraint.

## Design Principles

- Files stay visible and inspectable — never let a UI pattern make the underlying Markdown feel hidden or secondary to the agent.
- Every change is visible and reversible — the agent does real work, and each turn's edits land as a change summary with diffs and one-tap undo; writers who want to approve first can turn on review mode.
- Thumb-first — every primary flow works one-handed on a phone; larger screens add panes, never features.
- Restraint over decoration — structure comes from spacing, hairlines, and type weight; add visual elements only when they label something true.
- Model-agnostic, not model-flavored — the UI belongs to worldbookllm, not to the look of any single AI provider's chat product.
- Local-first confidence — the interface should read as something that respects and exposes the user's own files, not one that gates access behind app-only abstractions.

## Accessibility & Inclusion

WCAG 2.1 AA as the general target in both light and dark themes: sufficient contrast, full keyboard navigation, visible focus states, and `prefers-reduced-motion` support (already present in the base stylesheet). No additional named user needs beyond standard AA conformance at this time.
