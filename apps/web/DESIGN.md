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

### Focus

A 2px accent outline with 2px offset on every focusable element (inputs use the border + halo instead). Never remove focus styles.

### Header

Surface background with a bottom hairline. The wordmark is a small accent dot plus "worldbookllm" in 650 weight. Nav links are `--muted`; the current page is `--text`.

### Book tabs

Write / Reader / Bible / Agent / Health / Project (a series bible has no Reader). On phones: a fixed bottom bar of equal columns on `--surface`, the current tab in accent with a 2px top indicator. From 800px: a side rail card (12px radius, 0.35rem inset) where each tab is an 8px-rounded row and the current one gets an `--accent-soft` fill. While an agent turn runs, the Agent tab shows a small pulsing accent dot.

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

Write → Branches lists each chapter as a card: title, id, and small status tags (Start, Ending, and Not reachable in danger), then one row per choice (text field, "Leads to" select, Remove) that stacks on phones. A summary card above names endings, unreachable chapters, and broken choices with links to their cards. Write → Play runs the book's ink build with the inkjs runtime: each passage in the Reader's serif column under its chapter heading, "You chose: …" above it, the choices as full-width secondary buttons, and "The end." with Play again at an ending. The choices made are in the address, so Back steps back. A collapsed "ink source" panel shows the ink the build wrote.

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
