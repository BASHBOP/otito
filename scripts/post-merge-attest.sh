#!/usr/bin/env bash
# Post-merge audit attestation for pushes to main.
# Generates a review verdict, appends a hash-chained ledger record, and verifies the chain.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MERGE_SHA="${GITHUB_SHA:-$(git rev-parse HEAD)}"
BASE_SHA="${GITHUB_EVENT_BEFORE:-}"
if [ -z "$BASE_SHA" ] || ! git rev-parse --verify "${BASE_SHA}^{commit}" >/dev/null 2>&1; then
  if git rev-parse --verify "HEAD~1^{commit}" >/dev/null 2>&1; then
    BASE_SHA="$(git rev-parse HEAD~1)"
  else
    BASE_SHA="$MERGE_SHA"
  fi
fi

LEDGER="$ROOT/audit-pilot/ledger.jsonl"
if [ -f "$LEDGER" ] && grep -q "\"mergeSha\":\"$MERGE_SHA\"" "$LEDGER"; then
  echo "post-merge-attest: merge $MERGE_SHA already attested; verifying chain only"
  node audit-pilot/attest.mjs --verify
  exit 0
fi

PR="$(git log -1 --format=%s | sed -n 's/.*(#\([0-9][0-9]*\)).*/\1/p' || true)"
AUTHOR="$(git log -1 --format=%an)"
COMMITTED="$(git log -1 --format=%aI)"
VERDICT="$ROOT/audit-pilot/verdict-latest.json"

if [ -n "$PR" ] && command -v gh >/dev/null 2>&1; then
  echo "post-merge-attest: review via PR #$PR"
  if ! node src/cli.js review . --pr "$PR" --json > "$VERDICT" 2>/dev/null; then
    echo "post-merge-attest: PR review unavailable; falling back to diff $BASE_SHA..$MERGE_SHA"
    node src/cli.js review . --base "$BASE_SHA" --head "$MERGE_SHA" --json > "$VERDICT"
  fi
else
  echo "post-merge-attest: review via diff $BASE_SHA..$MERGE_SHA"
  node src/cli.js review . --base "$BASE_SHA" --head "$MERGE_SHA" --json > "$VERDICT"
fi

node audit-pilot/attest.mjs \
  --verdict "$VERDICT" \
  --merge "$MERGE_SHA" \
  --prev "$BASE_SHA" \
  --pr "${PR:-0}" \
  --author "$AUTHOR" \
  --committed "$COMMITTED"

node audit-pilot/attest.mjs --verify
