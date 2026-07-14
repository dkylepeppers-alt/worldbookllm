# Claude Code hooks

## session-start.sh

Installs workspace dependencies at session start on Claude Code on the web (guarded by `CLAUDE_CODE_REMOTE`), so tests and linters work immediately in fresh cloud containers. No-op on local machines.

**Not yet registered** — Claude Code sessions may not edit `.claude/settings.json` themselves. To activate it (and auto-formatting, which keeps CI's `format:check` green for agent-authored edits), merge this into `.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/session-start.sh",
            "timeout": 600,
            "statusMessage": "Installing workspace dependencies"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "jq -r '.tool_input.file_path // .tool_response.filePath // empty' | { read -r f; [ -n \"$f\" ] && pnpm exec prettier --write --ignore-unknown \"$f\"; } 2>/dev/null || true"
          }
        ]
      }
    ]
  }
}
```

The `"matcher": "startup"` keeps the install off resume/`/clear`/compaction — it only runs when a fresh session (and on the web, a fresh container) starts.

Hook commands run directly and do not consult the permissions allowlist — the allowlist governs commands the agent itself runs via the Bash tool. Two entries are still worth adding so the agent can format files and boot the app without prompting: `"Bash(pnpm exec prettier:*)"` and `"Bash(pnpm dev)"`.
