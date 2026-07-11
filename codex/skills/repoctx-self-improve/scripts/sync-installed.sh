#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

sync_to() {
  local target="$1"
  mkdir -p "$target"
  rsync -a --delete "$SKILL_DIR/" "$target/"
  echo "Synced repoctx-self-improve → $target"
}

sync_to "${HOME}/.cursor/skills/repoctx-self-improve"

if [[ -d "${CODEX_HOME:-$HOME/.codex}/skills" ]]; then
  sync_to "${CODEX_HOME:-$HOME/.codex}/skills/repoctx-self-improve"
fi
