# ADR 0004 — pnpm workspace monorepo

**Status:** accepted · 2026-07-10

## Context

The app has two runtimes (Node server, browser SPA) that must share types — API payloads, notebook/source/chat models, zod schemas.

## Decision

One repository with **pnpm workspaces**: `apps/server`, `apps/web`, `packages/shared`.

## Rationale

- Shared types in `packages/shared` keep the API contract typed end to end without publishing packages or duplicating definitions.
- pnpm workspaces are lightweight (no extra build orchestrator needed at this scale), fast, and already the tooling available in the dev environment.
- Single `pnpm lint / typecheck / test / build` fan-out keeps CI simple.

## Consequences

- Root-level tooling (ESLint flat config, Prettier, tsconfig base) is shared; packages override only what differs.
- If build orchestration ever gets slow, Turborepo/Nx can be added without restructuring.
