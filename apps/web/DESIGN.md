---
name: worldbookllm
description: A cartographer's field atlas for source-grounded creative writing
colors:
  paper: '#e8e9e3'
  surface: '#f8f8f4'
  ink: '#17212b'
  blueprint: '#2457c5'
  vermilion: '#c9442e'
  lichen: '#5f705a'
  line: '#b8bdb8'
  muted: '#5a656d'
typography:
  display:
    fontFamily: 'Archivo Variable, Archivo, system-ui, sans-serif'
    fontSize: 'clamp(2rem, 8vw, 4.8rem)'
    fontWeight: 740
    lineHeight: 1.02
    letterSpacing: '-0.035em'
  headline:
    fontFamily: 'Archivo Variable, Archivo, system-ui, sans-serif'
    fontSize: 'clamp(1.4rem, 4vw, 2.25rem)'
    fontWeight: 700
    lineHeight: 1.02
    letterSpacing: '-0.035em'
  body:
    fontFamily: 'Source Serif 4 Variable, Georgia, serif'
    fontSize: 'clamp(1.02rem, 2.5vw, 1.18rem)'
    fontWeight: 400
    lineHeight: 1.72
  label:
    fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace'
    fontSize: '0.68rem'
    fontWeight: 650
    letterSpacing: '0.095em'
rounded:
  none: '0px'
  sm: '2px'
  md: '3px'
  lg: '4px'
  dialog: '8px'
spacing:
  xs: '0.35rem'
  sm: '0.65rem'
  md: '1rem'
  lg: '2rem'
  xl: '6rem'
components:
  button-primary:
    backgroundColor: '{colors.blueprint}'
    textColor: '{colors.surface}'
    rounded: '{rounded.md}'
    padding: '0.7rem 1rem'
  button-primary-hover:
    backgroundColor: '#193f98'
  button-danger:
    backgroundColor: '{colors.vermilion}'
    textColor: '{colors.surface}'
    rounded: '{rounded.md}'
    padding: '0.7rem 1rem'
  button-secondary:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.md}'
    padding: '0.7rem 1rem'
  input:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.sm}'
    padding: '0.75rem 0.8rem'
  notebook-card:
    backgroundColor: '{colors.surface}'
    rounded: '{rounded.none}'
    padding: '1.25rem'
---

# Design System: worldbookllm

## 1. Overview

**Creative North Star: "The Field Atlas"**

worldbookllm reads like a working reference document, not a screen designed to be admired: cool paper stock under a faint blueprint grid, coordinate-style labels, indexed entries, and stamped-flat cards that behave like survey marks rather than floating tiles. It is built for use in the field — legible under scrutiny, precise about what it shows — not for display on a shelf. The metaphor is deliberate: a notebook is unmapped territory being surveyed and logged (the "atlas" of notebooks, "charting" as a loading state, "plotted territories" as an empty state, "route interrupted" as an error state), and every screen keeps that cartographic voice consistent rather than reaching for generic app chrome.

This system explicitly rejects the generic-SaaS-dashboard look — no cream/sand card grids, no gradient text, no hero-metric tiles — and rejects the stock-AI-chatbot skin, where a bare message-bubble list dominates the screen. Sources and their Markdown stay visually primary; chat is one region among several, reached for rather than defaulted into.

**Key Characteristics:**

- Cool, slightly green-grey paper background with a faint blueprint-blue grid, never a warm cream/sand neutral
- Serif body copy (Source Serif 4) against sans-serif structural type (Archivo) — an editorial contrast pairing, not two similar sans faces
- Flat, hard-edged cards with offset "stamp" shadows instead of soft blur — the system's signature elevation move
- Monospace, uppercase, letter-spaced micro-labels for anything that behaves like metadata (coordinates, counts, timestamps, indices)
- Two accent colors doing distinct jobs: blueprint for navigation/primary action, vermilion for danger/focus/active state — never interchangeable

## 2. Colors

A cool, desaturated paper-and-ink base carries the page; blueprint and vermilion are the only two colors allowed to raise their voice, each with one job.

### Primary

- **Blueprint Blue** (#2457c5): primary actions, links, the faint background grid, active navigation, the "ready" pulse animation. The system's default accent — used liberally for anything interactive or structural.

### Secondary

- **Vermilion** (#c9442e): danger actions (delete), focus rings, the active state of the wordmark's compass dot, active tab/list indicators, blockquote rules. Reserved for "this needs attention" — never decorative.

### Tertiary

- **Lichen Green** (#5f705a): status-ready and active-marker text only (connection tested, provider active). The quietest accent; a single, specific "this is working" signal.

### Neutral

- **Cool Paper** (#e8e9e3): the page background — cool grey-green, never warm cream or sand.
- **Warm Surface** (#f8f8f4): cards, panels, dialogs, inputs — one step lighter and warmer than the paper background, so surfaces read as laid-on-top without needing a shadow to prove it.
- **Deep Ink** (#17212b): primary text, borders, headings — a near-black navy, not pure black.
- **Line** (#b8bdb8): dividers, input borders, dashed empty-state borders — quiet structural grey with a hint of the paper's green.
- **Muted** (#5a656d): secondary text (timestamps, helper copy, provider notes) — blue-grey, always checked against its background for the 4.5:1 body-text minimum.

### Named Rules

**The Two-Accent Rule.** Blueprint and vermilion never swap jobs. Blueprint means "go / select / structural"; vermilion means "danger / focus / active-right-now." A screen that needs a third signal reaches for lichen, not a new hue.

## 3. Typography

**Display Font:** Archivo Variable (with Archivo, system-ui, sans-serif)
**Body Font:** Source Serif 4 Variable (with Georgia, serif)
**Label/Mono Font:** ui-monospace, SFMono-Regular, Consolas, monospace

**Character:** A geometric, condensable grotesque (Archivo, pulled narrower via `wdth 90` on headings) paired against a warm, classical serif body — structure and voice kept visually distinct, the way a survey report pairs stamped headers with typewritten notes.

### Hierarchy

- **Display** (740 weight, `clamp(2rem, 8vw, 4.8rem)`, 1.02 line-height, -0.035em tracking): page-level h1s — "Notebook atlas," source titles.
- **Headline** (700 weight, `clamp(1.4rem, 4vw, 2.25rem)`, 1.02 line-height, -0.035em tracking): section h2s — region headers, dialog titles.
- **Body** (400 weight, `clamp(1.02rem, 2.5vw, 1.18rem)`, 1.72 line-height, serif): source Markdown content and any long-form prose (page intros, provider notes, dialog copy). Capped at 78ch.
- **Label** (650 weight, 0.68rem, 0.095em tracking, monospace, uppercase): coordinate labels, source order/word-count, timestamps, legend text — anything that behaves like a data annotation rather than prose.

### Named Rules

**The Serif-Is-Canon Rule.** Source Serif 4 is reserved for content that came from — or reads like — the user's own material: Markdown bodies, page intros, dialog copy, provider notes. Archivo owns UI chrome, controls, and structural headings. If a string is describing the app, it's Archivo; if it's the user's words or long-form reading, it's the serif.

## 4. Elevation

The system is stamped, not floating. Cards and buttons carry hard-edged offset shadows with zero blur (`5px 5px 0 rgb(36 87 197 / 15%)` on notebook cards, `4px 4px 0 rgb(36 87 197 / 12%)` on settings cards) — the visual equivalent of an ink stamp landing slightly off-register on paper, not a tile hovering above a surface. The one exception is the dialog sheet, which uses a genuine soft ambient shadow (`0 18px 50px rgb(23 33 43 / 14%)`) because it is the one element actually lifting off the page into an overlay.

### Shadow Vocabulary

- **Stamp** (`box-shadow: 5px 5px 0 rgb(36 87 197 / 15%)`): notebook cards — a hard offset in blueprint blue, no blur.
- **Stamp, quiet** (`box-shadow: 4px 4px 0 rgb(36 87 197 / 12%)`): provider settings cards — the same move at lower opacity for a denser grid.
- **Sheet lift** (`box-shadow: 0 18px 50px rgb(23 33 43 / 14%)`): the dialog card only — soft, ambient, ink-tinted.

### Named Rules

**The One Soft Shadow Rule.** Blur is reserved for the dialog sheet, the only element genuinely floating above the page. Every other elevated surface uses a hard offset instead — if it isn't overlaying the page, it doesn't get blur.

## 5. Components

Every interactive surface reads as an instrument on a drafting table: square corners, visible 1px ink borders, and uppercase micro-labels doing the work that color-coding does elsewhere.

### Buttons

- **Shape:** 3px corner radius, 1px ink border, 44px minimum touch height.
- **Primary:** blueprint background (#2457c5), surface-colored text, darkens to #193f98 on hover.
- **Danger:** vermilion background (#c9442e), surface-colored text — delete and destructive actions only.
- **Secondary:** surface background, ink border and text — the default, low-emphasis action.
- **Disabled:** 0.58 opacity, `cursor: wait` (the app treats disabled-while-busy as "working," not "unavailable").

### Inputs / Fields

- **Style:** 1px line-colored border with an ink-colored bottom edge (a drafting-table "ruled line" effect), 2px radius, surface background.
- **Labels:** monospace, uppercase, 0.055em tracking, 720 weight — sit above the field, styled as a field-tag rather than soft placeholder-style copy.
- **Focus:** 3px solid vermilion outline, 3px offset — deliberately loud, never a soft glow.
- **Textareas:** monospace type, 1.55 line-height, vertically resizable only.

### Cards / Containers

- **Corner style:** square (0px radius) on notebook and provider cards — no rounding, reinforcing the "stamped card" language.
- **Background:** warm surface (#f8f8f4) against the cool paper page.
- **Shadow strategy:** the Stamp shadow from Elevation — hard offset, no blur.
- **Border:** 1px ink on notebook/provider cards; list rows use a 1px line-colored divider instead of a full border.
- **Signature detail:** the `map-index` — a large, low-opacity blueprint-blue numeral (e.g. "01") positioned top-right on each notebook card, styled as a page/plate number rather than a decorative icon.

### Navigation

- **Site header:** 58px minimum height, 1px ink bottom border, translucent surface background over the grid. The wordmark carries a small compass-dot mark (a vermilion-filled circle with a blueprint ring) before the text.
- **Site nav links:** uppercase, monospace-adjacent weight (720), no underline.
- **Mobile tabs:** fixed bottom bar, four equal columns, 58px touch targets, active tab marked by an inset top border in vermilion rather than a filled background — collapses away above the tablet breakpoint where the responsive grid takes over.

### Dialogs

- **Style:** bottom sheet on mobile (rounded top corners only), centered card from tablet width up (full rounding, 4px radius); the one place blur/soft shadow (Sheet Lift) appears.
- **Structure:** a monospace "coordinate-label" eyebrow (e.g. "Confirm action") above the heading, serif body copy in `.dialog-copy`, right-aligned action row.

### Source List Item (signature component)

Each source row carries a **spine** — a 4px vertical bar in lichen green along its left edge, switching to vermilion when the item is the active/open source. It behaves like a book spine or a survey flag, not a decorative accent stripe: it is the row's own state indicator, not a border-based callout pattern.

## 6. Do's and Don'ts

### Do:

- **Do** keep the page background a cool, desaturated paper (#e8e9e3) with the faint blueprint grid — never a warm cream or sand neutral.
- **Do** pair Archivo (UI/structure) against Source Serif 4 (user content/long-form prose) — keep that split consistent; don't let Archivo creep into Markdown bodies or vice versa.
- **Do** use hard offset "stamp" shadows (no blur) on any card or button that sits flat on the page; reserve soft blurred shadows for the dialog sheet alone.
- **Do** use monospace, uppercase, letter-spaced labels for anything that is metadata (counts, dates, coordinates, indices) — this is the system's substitute for iconography.
- **Do** keep blueprint for primary/structural and vermilion for danger/focus/active — the Two-Accent Rule.
- **Do** keep sources and Markdown content visually primary; chat regions are reached for, never the default full-bleed layout.

### Don't:

- **Don't** use a cream/sand/beige body background, gradient text, glassmorphism, or a hero-metric-tile layout — this should never read as a generic SaaS dashboard.
- **Don't** default to a bare chat-bubble layout where the message list dominates the screen — that's the stock-AI-chatbot skin this system explicitly avoids.
- **Don't** add soft blurred shadows to cards, buttons, or list items — blur is reserved for the one element actually floating above the page (the dialog sheet).
- **Don't** use `border-left`/`border-right` as a decorative colored accent on cards or callouts. The source-list spine is the one sanctioned exception, and it functions as a state indicator (default vs. active), not decoration.
- **Don't** round corners on notebook/provider cards or buttons beyond 3-4px — square-cornered precision is the point, not softness.
- **Don't** let placeholder or muted text drop below the 4.5:1 contrast minimum against paper or surface; the muted blue-grey (#5a656d) is already tuned to that floor — don't lighten it further "for elegance."
