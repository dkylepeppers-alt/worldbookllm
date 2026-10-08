# ADR 0025 — The agent keeps recent turns verbatim, within a budget

**Status:** accepted · 2026-10-08 · amends ADR 0023 decision 1

## Context

ADR 0023 compacted every earlier turn as soon as the next message arrived: file reads and skill text became stubs, and the text of the agent's own writes was dropped. That cut input sharply, but the agent forgot the file it had just read or written one message ago. A writer who says "now tighten the ending" after a draft found the agent re-reading the chapter it had just written, or working from a stub. Each message started from near zero.

ADR 0023 also turned on prompt caching for Claude models on OpenRouter and NanoGPT. Caching makes a repeated prefix cheap, but compacting on every turn rewrote that prefix on every turn, so the previous turn was never billed at the cached rate.

## Decision

1. **Earlier turns replay verbatim while they fit a budget** (`fitEarlierTurns` in `agent/context.ts`). The budget is 160,000 characters of serialized messages, about 40k tokens, which leaves room for the system prompt, tools, and the turn in progress in a 128k-token context.
2. **Over budget, the oldest turns are compacted, as ADR 0023 compacted every turn.** The latest earlier turn is always kept verbatim.
3. **The boundary moves in half-budget steps.** Marks fall at the first turn after each further half-budget of history. They depend only on earlier turns, which never change. The boundary is the first mark after which the history fits the budget. As the conversation grows, it stays put until another half-budget has accumulated, so the cached prefix is rewritten once per step instead of on every turn.
4. **Within a turn, nothing changes.** `supersedeRepeatedReads` still stubs a file's older reads once it is read again, which loses nothing.

## Consequences

- The agent keeps what it read and wrote in recent turns, and follow-up requests work on the text it has.
- Turns that follow earlier ones send more input than under ADR 0023 until the budget is reached. With prompt caching, that repeated prefix is billed at the cached rate. Without caching, a long conversation costs more per step, up to the budget.
- After a boundary move, the replayed history is between half the budget and the whole budget, plus the stubs of compacted turns.
- The budget is fixed. Sizing it to each model's context window is still to do.
