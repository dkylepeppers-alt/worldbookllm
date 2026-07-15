# Product

## Register

product

## Platform

web

## Users

Writers, worldbuilders, game masters, roleplay designers, and fiction developers — anyone building and maintaining a project bible for an ongoing creative work. They arrive with existing material (lore documents, wiki pages, character sheets, campaign notes) and need it organized, searchable, and usable as grounding for AI-assisted drafting, without losing direct ownership of the source text itself.

## Product Purpose

worldbookllm ingests a writer's sources, converts them into clean, inspectable Markdown, and lets them chat with an AI grounded in that material — drafting, expanding ideas, and checking against established canon. It is NotebookLM's shape (source-grounded AI over your own documents) redirected at creative work instead of research, and de-locked from a single AI provider: the user brings their own key and picks their own model, per notebook or per chat. Success is the user always trusting the source of truth — every source stays a plain, readable, editable Markdown file they can verify, never something folded invisibly into an opaque AI context.

## Positioning

NotebookLM, but for building worlds instead of researching them — and with a model you choose instead of one you're locked into.

## Brand Personality

A cartographer's field kit: precise, exploratory, tactile. The interface already speaks this — paper-toned surfaces under a faint blueprint grid, a compass-mark wordmark, coordinate-style labels, an "atlas" of notebooks, "charting" and "plotted territories" as loading and empty-state language. The voice treats a notebook like unmapped territory being surveyed and logged, not a folder in a SaaS dashboard: confident, unfussy, a little bit fieldwork-romantic without tipping into whimsy or decoration for its own sake.

## Anti-references

Not a generic SaaS dashboard — no cream/sand card grids, gradient text, or hero-metric tiles; this shouldn't read as a B2B analytics product. Not a stock AI chatbot skin either — chat is one region among several, never the dominant element that pushes sources and Markdown into the background. The source material and its cartographic framing stay visually primary; chat stays a tool the user reaches for, not the whole app.

## Design Principles

- Sources stay visible and inspectable — never let a UI pattern make the underlying Markdown feel hidden or secondary to the chat.
- Precision over decoration — the cartographic motifs (coordinates, indices, spines, grid) earn their place by organizing real information; add new ones only when they label something true, not for atmosphere alone.
- Model-agnostic, not model-flavored — the UI belongs to worldbookllm, not to the look of any single AI provider's chat product.
- Local-first confidence — the interface should read as something that respects and exposes the user's own files, not one that gates access behind app-only abstractions.

## Accessibility & Inclusion

WCAG 2.1 AA as the general target: sufficient contrast, full keyboard navigation, visible focus states, and `prefers-reduced-motion` support (already present in the base stylesheet). No additional named user needs beyond standard AA conformance at this time.
