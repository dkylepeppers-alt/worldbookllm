# ADR 0022 — The agent asks the writer with choices

**Status:** accepted · 2026-10-01 · builds on ADR 0015

## Context

Brainstorming is a large part of what writers do with the agent: premises, names, directions for a scene. The agent offered these as numbered prose ("1. Dark fantasy… 2. Cozy mystery…"), and the writer typed an answer back. That is slow on a phone and loses the structure of the choice. Coding agents solve this with a question tool that the interface renders as buttons.

## Decision

1. **`ask_user` is an agent tool.** It takes 1–4 questions, each with a short optional `header`, 2–4 options (a label and an optional description), and an optional `multiSelect`. The arguments are validated with the shared `askUserArgumentsSchema`. Invalid arguments come back to the model as a tool error within the same turn, like any other tool.
2. **"Other" is always offered.** The agent never lists it; the app adds it as the last choice, with a text field, so the writer can always answer in their own words.
3. **The turn ends on a question.** After a step whose `ask_user` call succeeded, the loop stops and the turn is recorded as `complete`. The tool's stored result tells the model that the answer arrives as the next message. There is no new message status: a chat is waiting on the writer when its last message is a finished turn whose last step asked.
4. **The answer is an ordinary user message.** It goes through the existing send route, so streaming, review mode, checkpoints, and the one-turn-per-book guard apply unchanged. Its content is the chosen label (or labels, or the written answer) for one question, or one labelled line per question. The message carries `answeringCallId`, which the server turns into a note so the model links the answer to its question. Provider history needs no change: the stored tool call and result replay, then the answer follows as the user's message.
5. **The writer is never forced to answer by tapping.** The composer stays available; a typed message answers in free form.
6. **The system prompt tells the agent to use it** whenever it offers a choice between options, instead of listing them in prose.

## Rationale

Ending the turn keeps the loop simple and the conversation honest: the model does not guess an answer, and nothing waits on an open stream that a phone may drop. Sending the answer as a normal message reuses every existing path and keeps the chat readable as plain text, which keeps ADR 0003's promise that nothing the writer did is hidden. Matching the shape of established question tools (up to four questions, two to four options, multi-select, Other) gives models a contract they already handle well.

## Consequences

- Turns that ask stop early, so brainstorming takes more, shorter turns.
- A model that ignores the instruction still works; it just lists options in prose as before.
- Partly picked answers are kept per chat and call in the browser's drafts storage, like the composer's text.
