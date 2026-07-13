# Copilot instructions

Canonical agent guidance lives in [`AGENTS.md`](../AGENTS.md) — read it first. Key points:

- pnpm 9 monorepo, Node ≥ 20. Verify changes with `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build` from the repo root.
- `apps/server` is ESM with NodeNext resolution: relative imports need explicit `.js` extensions.
- ESLint flat config and Prettier live at the root only — never add per-package lint/format configs.
- Strict TypeScript everywhere (`strict` + `noUncheckedIndexedAccess` from `tsconfig.base.json`).
- User data lives in `data/` (gitignored). Markdown files on disk are the source of truth; SQLite is a rebuildable index. Never design features that hide source content from the user.
- Check `docs/ROADMAP.md` before adding features; architecture decisions get an ADR in `docs/decisions/`.
