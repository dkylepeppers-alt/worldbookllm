# worldbookllm

A local-first, model-agnostic creative writing and worldbuilding workspace: story-skills books as Markdown on disk, developed with a tool-calling agent on user-chosen providers. See `docs/ARCHITECTURE.md` for the system design and `docs/ROADMAP.md` for milestone scope — check the roadmap before adding features to keep milestones thin.

## Commands

All from the repo root (pnpm 9, Node ≥ 24):

- `pnpm dev` — start server (http://localhost:3001) and web UI (http://localhost:5173) together
- `pnpm test` / `pnpm lint` / `pnpm typecheck` / `pnpm build` — fan out to all packages
- `pnpm format` — Prettier write; CI runs `format:check`
- Single package: `pnpm --filter @worldbookllm/server test` (also `.../providers`, `.../web`, `.../shared`)

## Layout

- `apps/server` — Fastify API (TypeScript, ESM with NodeNext — relative imports need `.js` extensions). Owns all state: data dir, SQLite, provider calls. `src/app.ts` builds the app (testable via `fastify.inject()`); `src/index.ts` listens. `src/story/` is the story-skills core (ADR 0014): the only code that runs the pinned `story` CLI (`StoryCli`, validated against a vendored command table that a test keeps in sync with upstream), path confinement, the book index, checkpoints, and review mode's staged copies (ADR 0016). Never spawn `story` or touch book files outside it. `src/agent/` is the story-skills agent (ADR 0015): the tool-calling loop, its tools, and the story-skills installer; its UI is the Agent tab in `apps/web/src/agent/`. M7 progress and remaining work: `docs/superpowers/plans/2026-09-30-m7-handoff.md`.
- `apps/web` — React 19 + Vite SPA. Talks to the server only via `/api` (proxied in dev). Tests use vitest + jsdom + testing-library.
- `apps/e2e` — Playwright browser journeys backed by a deterministic local stub provider.
- `packages/providers` — framework-free provider core ported from SillyTavern. Builds requests and normalizes responses; callers inject keys/config and perform network I/O.
- `packages/shared` — types/schemas shared across both; imported as `@worldbookllm/shared` (exports raw TS from `src/`, no build step).

## Conventions

- Strict TS everywhere (`tsconfig.base.json`: `strict` + `noUncheckedIndexedAccess`); packages extend the base.
- ESLint flat config + Prettier at the root only — don't add per-package configs.
- User data lives in `data/` (gitignored): books as `.md` files on disk are the source of truth; SQLite is a rebuildable index (ADR 0003, ADR 0014). Never design features that hide the writer's content from them.
- Architecture decisions get an ADR in `docs/decisions/`.

## Design context

`apps/web` has captured Impeccable design context: `apps/web/PRODUCT.md` (register: product, platform: web — users, purpose, positioning, anti-references) and `apps/web/DESIGN.md` (the "Field Atlas" visual system: paper/blueprint/vermilion palette, Archivo + Source Serif 4 pairing, stamped card shadows). Read both before making UI changes in `apps/web`.
