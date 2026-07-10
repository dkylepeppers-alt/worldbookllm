# ADR 0002 — React + Vite frontend, Fastify backend

**Status:** accepted · 2026-07-10

## Context

With the local-first shape fixed (ADR 0001), the stack question was React + Vite SPA with a separate Node API server, versus Next.js full-stack, versus Svelte.

## Decision

**React + Vite + TypeScript** for the UI; a small **Fastify** server for the API.

## Rationale

- A plain Node server is the honest architecture for this app's workload: long-lived streaming chat responses, background ingestion jobs, and direct filesystem/SQLite access are the default case in Fastify and slightly against the grain in Next.js's request-scoped model.
- Next.js's strengths (SSR, SEO, edge deployment) are irrelevant to a local single-user tool; its complexity (server/client component boundaries, caching semantics) would be carried without benefit.
- React has the largest ecosystem for the components this app needs most: Markdown editors, chat UIs, virtualized lists.
- Clean split: the frontend is a static bundle the server serves in production — one process, one port, SillyTavern-style.

## Consequences

- We wire routing, the API client layer, and dev orchestration ourselves (small, one-time cost).
- Two dev processes (Vite + server), orchestrated by `pnpm -r --parallel dev`, with Vite proxying `/api`.
