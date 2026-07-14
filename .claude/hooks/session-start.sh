#!/bin/bash
set -euo pipefail

# Install workspace dependencies so tests/linters work in Claude Code on the
# web, where sessions start from a fresh clone. Local checkouts manage their
# own node_modules, so do nothing there.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

if ! command -v pnpm >/dev/null 2>&1; then
  corepack enable pnpm
fi

pnpm install
