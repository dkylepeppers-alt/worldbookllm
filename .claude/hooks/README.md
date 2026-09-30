# Claude Code hooks

Both hooks are registered in `.claude/settings.json`.

## session-start.sh (`SessionStart`, matcher `startup`)

Installs workspace dependencies at session start on Claude Code on the web (guarded by `CLAUDE_CODE_REMOTE`), so tests and linters work immediately in fresh cloud containers. No-op on local machines. The `startup` matcher keeps the install off resume/`/clear`/compaction — it only runs when a fresh session (and on the web, a fresh container) starts.

## Prettier on write (`PostToolUse`, matcher `Write|Edit`)

An inline command that runs `pnpm exec prettier --write --ignore-unknown` on each file the agent writes or edits, which keeps CI's `format:check` green for agent-authored edits.

## Permissions

Hook commands run directly and do not consult the permissions allowlist — the allowlist governs commands the agent itself runs via the Bash tool. It pre-approves the root scripts (`pnpm test`, `lint`, `typecheck`, `build`, `format`, `dev`, …), `pnpm exec prettier`, and `pnpm dedupe --check`.
