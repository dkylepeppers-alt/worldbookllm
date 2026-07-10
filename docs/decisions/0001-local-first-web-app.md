# ADR 0001 — Local-first web app

**Status:** accepted · 2026-07-10

## Context

worldbookllm needs a deployment model. The candidates were a hosted SaaS (Next.js + cloud database + accounts), a desktop app (Tauri/Electron), and a local-first self-hosted web app (Node server + browser UI on the user's machine, as SillyTavern does).

## Decision

Build a **local-first web app**: a Node/TypeScript server and browser UI the user runs locally with `pnpm dev` / `pnpm start`.

## Rationale

- The target audience (writers, worldbuilders, SillyTavern users) already runs local AI tooling and expects to bring their own API keys. Keys and creative work stay on their machine.
- No auth, key-escrow encryption, storage billing, or hosting infrastructure needed for v1 — that effort goes into the product instead.
- Plain files on disk (see ADR 0003) only work cleanly when the app runs where the files live.
- The shape can grow later: a static frontend + Node server drops into Tauri for desktop packaging, and a hosted variant remains possible if ever wanted.

## Consequences

- Users must install Node/pnpm and run a command — acceptable for this audience, and desktop packaging can remove it later.
- No multi-device sync in v1; users can sync the data directory themselves (git, Syncthing, Dropbox).
