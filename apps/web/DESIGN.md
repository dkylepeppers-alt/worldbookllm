---
name: worldbookllm
description: A calm, modern writing tool for story-skills books
colors:
  light:
    bg: '#f7f7f5'
    surface: '#ffffff'
    surface-2: '#f1f1ee'
    text: '#1d1d1f'
    prose: '#2a2a2d'
    muted: '#5e6066'
    border: '#e3e3df'
    border-strong: '#878782'
    accent: '#4f46e5'
    accent-hover: '#4338ca'
    on-accent: '#ffffff'
    danger: '#c0262d'
    success: '#1f7a3d'
  dark:
    bg: '#131315'
    surface: '#1b1b1e'
    surface-2: '#232327'
    text: '#ececee'
    prose: '#dcdcdf'
    muted: '#a0a0a8'
    border: '#2d2d32'
    border-strong: '#707078'
    accent: '#8b8cf6'
    accent-hover: '#a5a6f9'
    on-accent: '#111114'
    danger: '#f47174'
    success: '#5cc98a'
typography:
  ui: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
  prose: "'Source Serif 4 Variable', Georgia, serif"
  mono: "ui-monospace, 'SFMono-Regular', 'SF Mono', Menlo, Consolas, monospace"
rounded:
  sm: '6px'
  md: '8px'
  lg: '12px'
---

# Design System: worldbookllm

## 1. Overview

**North star: a quiet writing tool.** worldbookllm should feel like a well-made editor — iA Writer, Linear, Things — not a themed object. The interface is neutral and gets out of the way; the writer's words, set in a serif, are the only thing on screen with a voice. Structure comes from spacing, hairline borders, and type weight, not from decoration.

**Key characteristics:**

- A neutral page with white (or near-black) surfaces laid on it; no textures, grids, or gradients.
- System sans for everything the app says; Source Serif 4 only for what the writer wrote.
- One accent (indigo) for interaction and current state. Red only for danger, green only for "done/working".
- Soft corners (8px controls, 12px cards) and one quiet card shadow.
- Light and dark themes that follow the operating system, built from the same tokens.

All of it lives in `src/styles.css` as CSS custom properties on `:root`, redefined under `@media (prefers-color-scheme: dark)`. Components use the variables, never raw colors.

## 2. Color

| Token             | Job                                                                          |
| ----------------- | ---------------------------------------------------------------------------- |
| `--bg`            | Page background.                                                             |
| `--surface`       | Cards, panels, inputs, header, tab bar, dialogs.                             |
| `--surface-2`     | Recessed areas: `pre` blocks, segmented-control tracks.                      |
| `--text`          | UI text and headings.                                                        |
| `--prose`         | Markdown and manuscript text (slightly softer than `--text` for long reads). |
| `--muted`         | Secondary text: labels, paths, timestamps, hints. Kept at 4.5:1 or better.   |
| `--border`        | Hairlines: dividers, card borders.                                           |
| `--border-strong` | Control borders (buttons, inputs); at least 3:1 against every surface.       |
| `--accent`        | Links, primary buttons, focus rings, the current tab, pressed toggles.       |
| `--accent-soft`   | Tinted background for the current tab, pressed toggles, selected rows.       |
| `--on-accent`     | Text on accent or danger fills.                                              |
| `--danger`        | Destructive buttons, error borders, failed status.                           |
| `--success`       | Ready/applied/done status and added diff lines.                              |
| `--backdrop`      | Dialog scrim.                                                                |

**One accent rule.** Indigo means "interactive or current". Don't introduce a second hue for emphasis; use weight, size, or `--accent-soft`. Red and green are status colors, never decoration.

Contrast targets WCAG 2.1 AA in both themes. The dark palette is not an inversion: surfaces step up in lightness (`bg` → `surface` → `surface-2`) and the accent is lightened so it holds 4.5:1 on dark surfaces.

## 3. Typography

- **UI — system sans** (`--font-ui`): navigation, buttons, labels, headings, helper copy, dialogs. Fast, native, and familiar on every platform; no web font to load.
- **Prose — Source Serif 4** (`--font-prose`): `.markdown-body` and the Reader. The serif marks the writer's own words.
- **Mono** (`--font-mono`): file paths, frontmatter keys, tool names, diffs, and the raw Markdown editor.

Scale: `h1` `clamp(1.6rem, 5vw, 2.25rem)` / 650; `h2` `clamp(1.2rem, 3.2vw, 1.5rem)` / 620; `h3` 1.05rem / 620; body 1rem; labels 0.875rem / 550; metadata (`.coordinate-label`) 0.8rem / 550 in `--muted`. Headings use −0.015em tracking. No uppercase labels and no letter-spaced small caps; sentence case everywhere.

Prose reads at `clamp(1.02rem, 2.5vw, 1.18rem)`, 1.72 line height (1.8 in the Reader), capped at 78ch (68ch in the Reader).

## 4. Shape and elevation

- **Radius:** `--radius-sm` 6px, `--radius` 8px for buttons, inputs, and chips, `--radius-lg` 12px for cards, panels, and dialogs.
- **Borders first:** cards are a 1px `--border` hairline on `--surface`.
- **Shadows:** `--shadow-card` (barely there) on cards; `--shadow-raised` on hover for clickable cards; `--shadow-dialog` only on dialogs. Nothing else casts a shadow.

## 5. Components

### Buttons

44px minimum height, 8px radius, weight 550.

- **Primary:** accent fill, `--on-accent` text; `--accent-hover` on hover.
- **Secondary:** surface fill, `--border-strong` border.
- **Danger:** `--danger` fill — destructive actions only.
- **Text button:** no border, underlined.
- **Disabled:** 0.55 opacity, `cursor: wait` (disabled means "working").

The file-picker label (`.file-button`) is styled as a secondary button.

### Inputs

Surface background, `--border-strong` border, 8px radius. Focus turns the border accent with a soft accent halo. Labels sit above the field in sentence case. Textareas use mono.

### Ink editor

An interactive book's chapters and `ink/` files open in CodeMirror (ADR 0031) instead of the textarea: mono text on `--surface` with an 8px radius and a `--border-strong` border, line numbers on `--surface-2`, and an accent outline when focused. Ink is coloured with tokens only: choices, gathers, `~`, and statements in accent weight 600, diverts and logic braces in accent, comments in muted italic, tags in muted, knot and stitch lines in heading weight. The compiler's errors and warnings are lint marks in the gutter and under the line, in tokens (a wavy `--danger` underline and dot for errors, `--border-strong` for warnings, and a matching left border in the hover tooltip); under the editor a polite live region lists this file's problems, each with a "Line N" text button that moves the cursor there. In Read mode, an ink file shows its planning as Markdown and its ink as mono source, and a chapter has a "Play from this chapter" link that plays the story as saved.

### Focus

A 2px accent outline with 2px offset on every focusable element (inputs use the border + halo instead). Never remove focus styles.

### Header

Surface background with a bottom hairline. The wordmark is a small accent dot plus "worldbookllm" in 650 weight. Nav links are `--muted`; the current page is `--text`.

### Book tabs

Write / Branches / Reader / Bible / Agent / Health / Project (a series bible has no Reader; only an interactive book, or one made interactive the earlier way and waiting to be converted to ink, has Branches). On phones: a fixed bottom bar of equal columns on `--surface`, the current tab in accent with a 2px top indicator. From 800px: a side rail card (12px radius, 0.35rem inset) where each tab is an 8px-rounded row and the current one gets an `--accent-soft` fill. While an agent turn runs, the Agent tab shows a small pulsing accent dot.

### Segmented controls

`.section-switch` (Bible sections) and `.mode-switch` (Read / Edit / Rename): the pressed option uses `--accent-soft` with accent text and border (section switch) or a raised surface chip on a `--surface-2` track (mode switch).

### Lists

`.entry-list` rows are separated by hairlines; the title is an accent link, metadata sits underneath as a muted label. Chapters on the Write tab list their scenes indented beneath them.

### Cards and panels

Book cards, settings cards, check cards, notices, the change summary, the agent's question card, the story commands panel, the Reader's contents, and the Project tab's file folders all share one treatment: `--surface`, 1px `--border`, 12px radius, `--shadow-card`. Clickable book cards raise on hover.

### Agent turn

- **Tool chips:** collapsed `<details>` rows; mono tool name, the target in muted text, and a status word (running in accent, done in success, failed in danger with a danger border). Expanding shows arguments and result in `pre` blocks on `--surface-2`.
- **Change summary:** a card listing each changed file with its change kind and an accent path button that opens the diff, then Undo turn. An undone summary drops its shadow and strikes the paths through.
- **Diff dialog:** mono lines; added lines on a 14% success tint with `+`, removed on a 12% danger tint with `−` (screen readers hear "Added"/"Removed"), unchanged runs folded.
- **Review mode:** the same card with Apply / Skip per file and Apply all / Skip all when more than one file is pending.
- **Questions (`ask_user`):** a card of option buttons; the chosen option gets an accent left edge and `--accent-soft` fill.

### Reader

One centered 68ch column: a collapsible contents card, optional export notes, then the manuscript in Source Serif 4 at 1.8 line height. Chapter headings use the UI sans; a scene break is a short centered rule.

### Branches and Play

An interactive book is written in ink (ADR 0030). The Branches tab opens on a summary card (chapters, choices, endings, variables; a danger line when the ink does not compile, linking to Health), Edit choices and Play links, a note that chapters are ink under their Chapter Text heading, and the map: one rounded box per chapter or `ink/` knot with its stitches folded in (start in `--accent-soft` with an accent border, endings with a 2px border, unreachable ones dashed in `--danger`), rows top to bottom by steps from the start and wrapping past six boxes, `--border-strong` arrows (dashed when a choice has a condition or changes a variable; loops and links back up curve around the right side), and an accent border on hover and keyboard focus. The map sits in a scrolling card and is repeated as a list under "The map as a list". A book that is not interactive gets a "Make it interactive" card, which lists the files the conversion changes (each opens the diff dialog) before "Convert to ink chapters", and an interactive edition card.

Branches → Choices lists each chapter as a card: title, mono knot name, a "Play from here" link, and small status tags (Start, Ending, and Not reachable in danger), then its closing choices as rows (text, a "Leads to" select of every knot, stitch, and the end, Remove, and mono "Only if" and "When picked" fields with an "Offer only once" checkbox) that stack on phones, or "With no choices, go on to" when it has none. An ending the form cannot show (a weave) is a warning card with the choices read-only and a link to edit the chapter as ink. A save that does not compile shows the compiler's lines; one refused because the file changed offers a Reload button.

Branches → Play runs the compiled story with the inkjs runtime: each passage in the Reader's serif column under its chapter heading, `# break` as a scene break, "You chose: …" above it, the choices as full-width secondary buttons, and "The end." with Play again at an ending. Where play started, the variables set first, the random seed, and the choices made are all in the address, so Back steps back and a link reopens the moment. A "Story state" card lists every variable; collapsed cards hold "Playtest from anywhere" (start from any knot or stitch with variables set), named "Saves" kept in the browser, and the whole story's ink source.

Health → Paths (ADR 0032), shown under Ink when the story compiles, plays every path and reports what playing finds. A mono summary line says how many states were played, or that it stopped early and is partial, and how many distinct endings it reached and in how many choices. Under it are entry lists: "Errors while playing", each with a "Reproduce in Play (N choices)" link that opens Play at those choices with seed 1; "No path reaches", the knots with links to their file and line; and "Choices never offered". In a partial report those two read "Not reached in the states played" and "Choices not offered in the states played", each with a muted note that the rest was not played. While it plays it shows the shared loading state, and a failure shows the shared error state with Retry.

### Discovery

Branches → Story setup (ADR 0033) is one column of `.branch-card` fieldsets: the story (premise, shape and tone, and endings, with the premise and opening scene in the prose serif since they are the writer's words, and a Draft / Redraft with the beat writer button), for a book with no chapters the opening, how you play (radio rows at 44px for the mode, a "Beat writer" select of the default and the custom agents with a hint naming the picked agent's skills, and a "More options" disclosure whose summary lists the current write-ahead, choices per beat, beat length, and rejoin), what the story remembers (variable rows like choice rows, with a full-width "What it means"; Suggest variables puts the beat writer's suggestions in a panel with an accent left edge, each with its own Add button, plus Add all), and the rules for choices folded in a disclosure card (a mono textarea). Help text under labels is `.field-hint`: `--muted` at 0.875rem and normal weight, so the fields carry the weight. The save button ends the form; from 800px it sits in a sticky bar on `--bg` with a top hairline. Unsaved changes are kept in the browser, and the bar says so with a Discard changes text button. The Branches hub adds a Discovery card with the mode, the open threads, and Play and write / Story setup.

In Play, discovery adds:

- a polite status line with a small pulsing accent dot (still under reduced motion) while the beat writer works, and failed jobs as warning blocks with Try again;
- "Your path", a wrapping row of the choices taken, each a text button back to that moment, the current one in weight 620;
- "Something else…" as a dashed, muted last choice that opens an inline form; a declined action shows the reason as a warning block with a "Try: …" text button;
- at a beat not written yet, a dashed-border panel ("Not written yet") with how it is reached, Draft three directions / Write it now, Write it yourself, and its note; drafts are cards with the prose in the serif, the choices with their intent and where they lead, the ink folded away, and Use this draft;
- "Write what happens next" at a beat that leads nowhere yet, a "Rewrite …" disclosure with a direction, and a card for variables the beat writer asks for.

The map draws a seed as an open node: `--bg` fill and a dashed `--border-strong` outline, labelled "not written". Health → Discovery lists open threads (each a link into Play at the fewest choices that reach it) and beats that need review, with Mark reviewed.

### Dialogs

Bottom sheet on phones (12px top corners), centered card from 620px. `--backdrop` scrim and `--shadow-dialog`.

## 6. Do's and don'ts

**Do**

- Use the tokens. If a color you need isn't a token, the design probably doesn't need it.
- Keep the writer's text in the serif and everything else in the system sans.
- Check every new screen in both light and dark mode at phone width.
- Keep touch targets at least 44px and every primary flow one-handed on a phone.

**Don't**

- Add textures, background patterns, gradients, glassmorphism, or hard offset shadows.
- Use uppercase or letter-spaced labels.
- Introduce a second accent hue, or use red/green for anything but status.
- Let the agent's chat dominate the layout; it is one tab among several.
- Hard-code colors in components or inline styles.
