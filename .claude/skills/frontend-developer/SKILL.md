---
name: frontend-developer
description: Conventions, testing patterns, and design guidance for working on apps/web, the React 19 + Vite SPA. Use when building or changing UI components, pages, routes, styles, or web tests.
---

# Frontend development in apps/web

## Architecture rules

- **The SPA talks to the server only via `/api`.** In dev, Vite proxies `/api` → `http://127.0.0.1:3001` (`apps/web/vite.config.ts`). Never call a provider, touch the filesystem, or read secrets from the frontend — all state and provider I/O belong to `apps/server`.
- All server communication goes through the typed client in `src/api/client.ts`, which validates responses with zod schemas from `@worldbookllm/shared`. Components get it via `useApi()` (`src/api/useApi.ts`, backed by `ApiContext`). New endpoints: add the schema/type to `packages/shared`, a method to `client.ts` with schema validation, then consume via `useApi()` — don't `fetch` ad hoc from components.
- Feature code is grouped by domain (`src/notebooks/`, `src/sources/`, `src/chats/`, `src/settings/`), with shared pieces in `src/components/`, `src/layout/`, `src/pages/`. Routing is React Router 7.
- Never hide source content from the user (ADR 0003): sources are user-owned Markdown; UI must keep them visible and editable, not buried behind AI summaries.

## Strict TS gotchas

`tsconfig.base.json` sets `strict` and `noUncheckedIndexedAccess` — indexing arrays/records yields `T | undefined`, so guard or use `.at()`/explicit checks rather than `!`. React 19: no `forwardRef` needed for new components (ref is a prop).

## Testing

Vitest + jsdom + testing-library; setup in `src/test/setup.ts`, helpers like `createTestClient.ts` in `src/test/`. Tests live next to code as `*.test.tsx` / `*.test.ts`.

- Query by role/label (`getByRole`, `findByText`) rather than test IDs; drive interactions with `@testing-library/user-event`.
- Mock at the ApiClient boundary (see `src/test/createTestClient.ts` and existing page tests), not at `fetch`.
- Run: `pnpm --filter @worldbookllm/web test`. Before pushing: `pnpm lint && pnpm format:check && pnpm typecheck`.

For visual verification of a change, use the project `verify` skill: boot with `pnpm dev` and drive http://localhost:5173 through the Playwright MCP server.

## Design quality

worldbookllm is a writer's tool — a calm, text-first workspace for people who live in their manuscripts. Aim the UI at that subject instead of generic dashboard defaults:

- **Ground choices in the subject.** The material is prose: generous line length limits, comfortable reading measure, restrained chrome around Markdown content. The user's words are the hero, not the app's.
- **Typography is the personality.** Pick display/body pairings deliberately for long-form reading and keep the scale consistent; don't mix ad-hoc sizes per component.
- **Structure encodes meaning.** Only add visual devices (numbering, badges, cards) when they reflect real information hierarchy — question decoration that any template would have.
- **Spend boldness in one place.** One distinctive element per view, surrounded by disciplined, quiet styling — avoid scattering accents, gradients, and animation everywhere.
- **Motion must earn its place.** Prefer none; when used, it should clarify a state change, not decorate.
- **Copy is design material.** Labels and empty states exist to make things easier to understand; write them specifically ("Paste or import your first source") rather than generically ("No items yet").

Styling lives in `src/styles.css` — extend the existing tokens/classes there rather than introducing a styling library without an ADR.
