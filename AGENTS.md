# worldbookllm

A local-first, model-agnostic creative writing and worldbuilding workspace: sources in as Markdown, organized into notebooks, developed through AI chat with user-chosen providers. See `docs/ARCHITECTURE.md` for the system design and `docs/ROADMAP.md` for milestone scope — check the roadmap before adding features to keep milestones thin.

## Commands

All from the repo root (pnpm 9, Node ≥ 20):

- `pnpm dev` — start server (http://localhost:3001) and web UI (http://localhost:5173) together
- `pnpm test` / `pnpm lint` / `pnpm typecheck` / `pnpm build` — fan out to all packages
- `pnpm format` — Prettier write; CI runs `format:check`
- Single package: `pnpm --filter @worldbookllm/server test` (also `.../providers`, `.../web`, `.../shared`)

## Layout

- `apps/server` — Fastify API (TypeScript, ESM with NodeNext — relative imports need `.js` extensions). Owns all state: data dir, SQLite, provider calls. `src/app.ts` builds the app (testable via `fastify.inject()`); `src/index.ts` listens.
- `apps/web` — React 19 + Vite SPA. Talks to the server only via `/api` (proxied in dev). Tests use vitest + jsdom + testing-library.
- `packages/providers` — framework-free provider core ported from SillyTavern. Builds requests and normalizes responses; callers inject keys/config and perform network I/O.
- `packages/shared` — types/schemas shared across both; imported as `@worldbookllm/shared` (exports raw TS from `src/`, no build step).

## Conventions

- Strict TS everywhere (`tsconfig.base.json`: `strict` + `noUncheckedIndexedAccess`); packages extend the base.
- ESLint flat config + Prettier at the root only — don't add per-package configs.
- User data lives in `data/` (gitignored): sources as `.md` files on disk are the source of truth; SQLite is a rebuildable index (ADR 0003). Never design features that hide source content from the user.
- Architecture decisions get an ADR in `docs/decisions/`.
