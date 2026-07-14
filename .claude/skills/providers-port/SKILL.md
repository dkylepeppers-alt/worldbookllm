---
name: providers-port
description: Constraints and workflow for touching packages/providers, the provider layer ported from SillyTavern. Use before modifying provider request building, message conversion, streaming, model lists, or when syncing against upstream SillyTavern.
---

# Working on packages/providers

This package is a TypeScript port of SillyTavern's chat-completion provider layer (ADR 0005, `docs/decisions/0005-sillytavern-provider-port-agpl.md`). It encodes years of accumulated per-provider quirks — treat existing behavior as load-bearing.

## Hard constraints

- **Framework-free, side-effect-free**: no filesystem access, no HTTP calls, no secret reads. The package only builds requests and normalizes responses; callers (the server) inject keys/config and perform all network I/O. Do not add imports that break this.
- **Raw TS, no build**: consumed as source via `packages/providers/src`; `build`/`typecheck` are `tsc --noEmit`. Don't add a build step or emitted artifacts.
- **Behavioral baseline is SillyTavern commit `29e0df488`.** Ported files carry an attribution header naming SillyTavern, the AGPL-3.0 license, that commit, and features deliberately not ported — keep those headers intact and add one to any newly ported file.
- **Scope**: only the modern chat-completions family. Legacy text-completion backends (Kobold, Mancer, Horde, …) are deliberately out of scope.
- **License**: the port is why the whole project is AGPL-3.0-only. Never copy SillyTavern code into packages outside `packages/providers` (the server-side secret store is the one sanctioned exception, already in place).

## Changing behavior

- Behavior fidelity is pinned by unit tests, not shared code. When fixing a provider quirk, first check upstream: diff the relevant SillyTavern file against commit `29e0df488` to see if upstream already solved it, and port the fix rather than inventing one.
- Upstream source locations (per ADR 0005): request building `src/endpoints/backends/chat-completions.js`, message conversion `src/prompt-converters.js`, stream-delta extraction `public/scripts/openai.js`, secrets `src/endpoints/secrets.js`.
- Every behavior change needs a test alongside the existing ones in `packages/providers/src/**/*.test.ts` — run with `pnpm --filter @worldbookllm/providers test`.
- A live end-to-end check exists only for NanoGPT: `SMOKE_NANOGPT_KEY=… pnpm --filter @worldbookllm/server test` runs `generation.nanogpt.smoke.test.ts` (self-skips without the key).
