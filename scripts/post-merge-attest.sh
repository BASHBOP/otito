#!/usr/bin/env bash
# Post-merge audit attestation for pushes to main.
# Generates a review verdict, appends a hash-chained ledger record, and verifies the chain.
#
# Runs against this checkout by default. To attest another repository:
#   OTITO_REPO    the repository to attest (default: the checkout this script is in)
#   OTITO_BIN     the otito command (default: node <this checkout>/src/cli.js)
#   OTITO_LEDGER  the ledger file (default: <repo>/audit-pilot/ledger.jsonl);
#                 the latest verdict is written beside it as verdict-latest.json
set -euo pipefail

TOOL_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="${OTITO_REPO:-$TOOL_ROOT}"
ROOT="$(cd "$ROOT" && pwd)"
OTITO_BIN="${OTITO_BIN:-node $TOOL_ROOT/src/cli.js}"
cd "$ROOT"

MERGE_SHA="${OTITO_TARGET_SHA:-${GITHUB_SHA:-$(git rev-parse HEAD)}}"
BASE_SHA="${GITHUB_EVENT_BEFORE:-}"
if [ -z "$BASE_SHA" ] || ! git rev-parse --verify "${BASE_SHA}^{commit}" >/dev/null 2>&1; then
  if git rev-parse --verify "HEAD~1^{commit}" >/dev/null 2>&1; then
    BASE_SHA="$(git rev-parse HEAD~1)"
  else
    BASE_SHA="$MERGE_SHA"
  fi
fi

LEDGER="${OTITO_LEDGER:-$ROOT/audit-pilot/ledger.jsonl}"
mkdir -p "$(dirname "$LEDGER")"
if [ -f "$LEDGER" ] && grep -q "\"mergeSha\":\"$MERGE_SHA\"" "$LEDGER"; then
  echo "post-merge-attest: merge $MERGE_SHA already attested; verifying chain only"
  $OTITO_BIN attest . --verify --ledger "$LEDGER"
  exit 0
fi

PR="$(git log -1 --format=%s "$MERGE_SHA" | sed -n 's/.*(#\([0-9][0-9]*\)).*/\1/p' || true)"
AUTHOR="$(git log -1 --format=%an "$MERGE_SHA")"
COMMITTED="$(git log -1 --format=%aI "$MERGE_SHA")"
VERDICT="$(dirname "$LEDGER")/verdict-latest.json"

is_valid_verdict() {
  node -e '
    const fs = require("node:fs");
    try {
      const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      process.exit(value.ok === true && ["PASS", "WARN", "FAIL"].includes(value.verdict) ? 0 : 1);
    } catch {
      process.exit(1);
    }
  ' "$VERDICT"
}

capture_review() {
  set +e
  "$@" > "$VERDICT" 2>/dev/null
  local status=$?
  set -e
  if is_valid_verdict; then
    if [ "$status" -ne 0 ]; then
      echo "post-merge-attest: review returned a blocking verdict (exit $status); recording it"
    fi
    return 0
  fi
  return 1
}

if [ "${OTITO_ATTEST_MODE:-auto}" != "diff" ] && [ -n "$PR" ] && command -v gh >/dev/null 2>&1; then
  echo "post-merge-attest: review via PR #$PR"
  if ! capture_review $OTITO_BIN review . --pr "$PR" --json; then
    echo "post-merge-attest: PR review unavailable; falling back to diff $BASE_SHA..$MERGE_SHA"
    if ! capture_review $OTITO_BIN review . --base "$BASE_SHA" --head "$MERGE_SHA" --json; then
      echo "post-merge-attest: no valid review verdict was produced" >&2
      exit 1
    fi
  fi
else
  echo "post-merge-attest: review via diff $BASE_SHA..$MERGE_SHA"
  if ! capture_review $OTITO_BIN review . --base "$BASE_SHA" --head "$MERGE_SHA" --json; then
    echo "post-merge-attest: no valid review verdict was produced" >&2
    exit 1
  fi
fi

$OTITO_BIN attest . --ledger "$LEDGER" \
  --verdict "$VERDICT" \
  --merge "$MERGE_SHA" \
  --prev "$BASE_SHA" \
  --pr "${PR:-0}" \
  --author "$AUTHOR" \
  --committed "$COMMITTED"

$OTITO_BIN attest . --verify --ledger "$LEDGER"
