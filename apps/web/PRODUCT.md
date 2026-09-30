# Product

## Register

product

## Platform

web — mobile-first (phone is the primary form factor), scaling to tablet and desktop

## Users

Novelists, serial and short-fiction writers, worldbuilders, and game masters building a book or series. They want an AI collaborator that knows the whole project (cast, world, plot threads, what each character knows at each chapter) and that keeps canon consistent instead of inventing over it. They work in short sessions, often on a phone, and they want to own their files.

## Product Purpose

worldbookllm is a local-first, model-agnostic workspace for [story-skills](https://github.com/danjdewhurst/story-skills) projects. A book is a directory of plain Markdown with one file per character, place, arc, chapter, scene, and continuity thread. The `story` CLI keeps that structure valid and checks continuity. An agent runs the story-skills craft skills against the project: it plans, drafts, revises, and checks, and every change it proposes is shown as a diff the writer applies or rejects. Research and lore come in through the ingestion pipeline as research notes. Success is the writer trusting both the canon and the tool: every file stays readable and editable, and nothing changes without their say.

## Positioning

A story-skills workspace in your pocket: the whole book bible, the manuscript, continuity checks, and an agent that follows real craft skills, with a model you choose and files you own.

## Brand Personality

A cartographer's field kit: precise, exploratory, tactile. The interface already speaks this — paper-toned surfaces under a faint blueprint grid, a compass-mark wordmark, coordinate-style labels, an "atlas" of books, "charting" and "plotted territories" as loading and empty-state language. The voice treats a book like territory being surveyed and logged, not a folder in a SaaS dashboard: confident, unfussy, a little bit fieldwork-romantic without tipping into whimsy or decoration for its own sake.

## Anti-references

Not a generic SaaS dashboard — no cream/sand card grids, gradient text, or hero-metric tiles; this shouldn't read as a B2B analytics product. Not a stock AI chatbot skin either — the agent is one tab among several, never the dominant element that pushes the manuscript and bible into the background. The writer's files and their cartographic framing stay visually primary; the agent stays a tool the writer reaches for, not the whole app.

## Design Principles

- Files stay visible and inspectable — never let a UI pattern make the underlying Markdown feel hidden or secondary to the agent.
- Nothing changes without the writer — the agent proposes, the writer applies; every model-made change is reviewable as a diff and undoable.
- Thumb-first — every primary flow works one-handed on a phone; larger screens add panes, never features.
- Precision over decoration — the cartographic motifs (coordinates, indices, spines, grid) earn their place by organizing real information; add new ones only when they label something true, not for atmosphere alone.
- Model-agnostic, not model-flavored — the UI belongs to worldbookllm, not to the look of any single AI provider's chat product.
- Local-first confidence — the interface should read as something that respects and exposes the user's own files, not one that gates access behind app-only abstractions.

## Accessibility & Inclusion

WCAG 2.1 AA as the general target: sufficient contrast, full keyboard navigation, visible focus states, and `prefers-reduced-motion` support (already present in the base stylesheet). No additional named user needs beyond standard AA conformance at this time.
