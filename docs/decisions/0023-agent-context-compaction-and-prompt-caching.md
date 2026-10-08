# ADR 0023 — The agent resends less, and caches what it resends

**Status:** accepted · 2026-10-02 · builds on ADR 0015 · decision 1 amended by ADR 0025

## Context

Every step of an agent turn is a separate model request carrying the whole conversation: the system prompt, every earlier turn, and the current turn so far. ADR 0015 replayed earlier turns word for word, including every tool result, and capped only single results at 24 KB. Nothing was cached.

Recorded turns showed what that costs. Requests of 200–470 KB were sent 20–24 times per turn, 4–9 MB of input for one turn. In one 393 KB request, `read_file` results were 56%, and the full text of the agent's own writes and edits was another 12%. Most of it was no longer needed: files read in earlier turns, a file read twice with the same contents, and older versions of files rewritten since.

## Decision

1. **Earlier turns are replayed compacted** (`agent/context.ts`, `compactEarlierTurns`). The conversation, every tool call, and short results stay as they were. File reads become a one-line stub naming the file and its size and telling the model to read it again if it needs it. Loaded skill text gets the same stub. Other results over 2,000 characters keep their first 500. Written text in `write_file` calls and long `find`/`replace` text in `edit_file` calls become stubs. Errors are never shortened.
2. **Within a turn, a repeated read replaces the earlier one** (`supersedeRepeatedReads`, run before every step). Once a file has been read again, its earlier reads, and the text of an earlier write to it, become stubs pointing at the later read. A path in another series book counts as a different file. Edits do not supersede reads, because the model may keep editing from what it read.
3. **Agent requests ask for prompt caching.** `GenerationParams.promptCache` is set for agent requests, and the provider layer applies it where a provider supports it for the model. For Claude models it sends top-level `cache_control: { type: "ephemeral" }` on OpenRouter and `prompt_caching: { enabled: true }` on NanoGPT. Both routers place the cache breakpoint themselves. Each step's request extends the previous one, so the resent prefix is billed at the cached rate (0.1× input) instead of full price. Other sources and models are unchanged.

## Consequences

- On recorded turns, compaction alone sends 52–68% less input when a turn follows earlier ones or reads a file more than once. A first turn that never rereads a file is unchanged, and only caching helps it.
- The model sometimes has to read a file again in a later turn. That costs one read, once, instead of carrying the file in every step of every later turn.
- Stubbing a superseded read changes an earlier message, so the cached prefix from that point on is written again (1.25× for that part) on the next step. This happens only when a file is reread.
- Caching for the direct Anthropic source and for other providers' Claude routes is not covered yet.
