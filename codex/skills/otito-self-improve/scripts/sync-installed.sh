#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

sync_to() {
  local target="$1"
  mkdir -p "$target"
  rsync -a --delete "$SKILL_DIR/" "$target/"
  echo "Synced otito-self-improve → $target"
}

sync_to "${HOME}/.cursor/skills/otito-self-improve"

if [[ -d "${CODEX_HOME:-$HOME/.codex}/skills" ]]; then
  sync_to "${CODEX_HOME:-$HOME/.codex}/skills/otito-self-improve"
fi
