#!/usr/bin/env bash
# Reconcile the durable audit ledger through a target commit on main.
# Missing first-parent commits are attested oldest-first so the hash chain
# remains deterministic and complete even when a bot merge suppresses push CI.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TARGET_SHA="${GITHUB_SHA:-$(git rev-parse HEAD)}"
LEDGER="$ROOT/audit-pilot/ledger.jsonl"

git rev-parse --verify "${TARGET_SHA}^{commit}" >/dev/null

LEDGER_SHAS="$(node -e '
  const fs = require("node:fs");
  const file = process.argv[1];
  if (!fs.existsSync(file)) process.exit(0);
  const rows = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
  process.stdout.write(rows.map((row) => JSON.parse(row).mergeSha).filter(Boolean).join("\n"));
' "$LEDGER")"
FIRST_SHA="$(printf '%s\n' "$LEDGER_SHAS" | sed -n '1p')"
LAST_SHA="$(printf '%s\n' "$LEDGER_SHAS" | tail -n 1)"

if [ -n "$FIRST_SHA" ]; then
  EXPECTED_SHAS="$FIRST_SHA"
  BETWEEN="$(git rev-list --first-parent --reverse "$FIRST_SHA..$LAST_SHA")"
  if [ -n "$BETWEEN" ]; then
    EXPECTED_SHAS="$EXPECTED_SHAS
$BETWEEN"
  fi
  if [ "$LEDGER_SHAS" != "$EXPECTED_SHAS" ]; then
    echo "reconcile-attestations: ledger has a first-parent coverage gap between $FIRST_SHA and $LAST_SHA" >&2
    exit 1
  fi
fi

if [ -n "$LAST_SHA" ]; then
  if ! git merge-base --is-ancestor "$LAST_SHA" "$TARGET_SHA"; then
    echo "reconcile-attestations: ledger tip $LAST_SHA is not an ancestor of target $TARGET_SHA" >&2
    exit 1
  fi
  RANGE="$LAST_SHA..$TARGET_SHA"
else
  RANGE="$TARGET_SHA"
fi

COMMITS="$(git rev-list --first-parent --reverse "$RANGE")"
if [ -z "$COMMITS" ]; then
  echo "reconcile-attestations: ledger already covers $TARGET_SHA"
  node audit-pilot/attest.mjs --verify
  exit 0
fi

for MERGE_SHA in $COMMITS; do
  if BASE_SHA="$(git rev-parse "${MERGE_SHA}^1" 2>/dev/null)"; then
    :
  else
    BASE_SHA="$MERGE_SHA"
  fi

  if [ "${OTITO_ATTEST_DRY_RUN:-0}" = "1" ]; then
    echo "$MERGE_SHA"
    continue
  fi

  ATTEST_MODE="diff"
  if [ "$MERGE_SHA" = "$TARGET_SHA" ]; then
    ATTEST_MODE="auto"
  fi

  OTITO_ATTEST_MODE="$ATTEST_MODE" \
    GITHUB_SHA="$MERGE_SHA" \
    GITHUB_EVENT_BEFORE="$BASE_SHA" \
    bash scripts/post-merge-attest.sh
done

if [ "${OTITO_ATTEST_DRY_RUN:-0}" != "1" ]; then
  node audit-pilot/attest.mjs --verify
fi
