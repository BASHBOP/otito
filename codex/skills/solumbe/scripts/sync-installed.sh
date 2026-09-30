#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET_DIR="${CODEX_HOME:-$HOME/.codex}/skills/solumbe"

mkdir -p "$TARGET_DIR"
rsync -a --delete "$SKILL_DIR/" "$TARGET_DIR/"
diff -qr "$SKILL_DIR" "$TARGET_DIR"

echo "Synced solumbe skill to $TARGET_DIR"
