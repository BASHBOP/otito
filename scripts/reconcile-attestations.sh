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

# Establish that the ledger describes THIS history before walking any range.
#
# A ledger whose commits are absent from the repository is not a coverage gap
# and must not be diagnosed as one: `git rev-list A..B` on commits that do not
# exist fails with "Invalid revision range" and exit 128, which reads like a
# broken script rather than a ledger bound to a history that no longer exists.
# That is what a rename or a history rewrite leaves behind — otito's ledger
# still chained against repoctx's commits, so every real run died at exit 128
# while runs that resolved no merge skipped and reported success.
#
# Reachability is checked first, and only then coverage.
ORPHANED=""
if [ -n "$FIRST_SHA" ]; then
  MISSING=""
  for SHA in $LEDGER_SHAS; do
    if ! git cat-file -e "${SHA}^{commit}" 2>/dev/null; then
      MISSING="$SHA"
      break
    fi
  done

  if [ -n "$MISSING" ]; then
    ORPHANED="ledger commit $MISSING is not in this repository"
  elif ! git merge-base --is-ancestor "$LAST_SHA" "$TARGET_SHA" 2>/dev/null; then
    ORPHANED="ledger tip $LAST_SHA is not an ancestor of target $TARGET_SHA"
  fi
fi

if [ -n "$ORPHANED" ]; then
  if [ "${OTITO_ATTEST_RESET_LEDGER:-0}" = "1" ]; then
    # Deliberate, opt-in restart. The superseded chain is NOT deleted: it stays
    # in the history of whatever branch carries it, and is archived beside the
    # new one so an auditor can still verify it on its own terms.
    ARCHIVE="$ROOT/audit-pilot/ledger-orphaned-$(date -u +%Y%m%dT%H%M%SZ).jsonl"
    if [ -f "$LEDGER" ]; then
      cp "$LEDGER" "$ARCHIVE"
      echo "reconcile-attestations: archived superseded chain to $(basename "$ARCHIVE")"
    fi
    : > "$LEDGER"
    echo "reconcile-attestations: $ORPHANED; starting a new chain at $TARGET_SHA"
    LEDGER_SHAS=""
    FIRST_SHA=""
    LAST_SHA=""
    # The new chain starts AT the tip rather than backfilling every ancestor.
    # Attesting 203 historical commits would mint verdicts for changes this
    # gate never actually ran on, which is a worse claim than an honest chain
    # that begins where the repository's real attestation does.
    RESET_TO_TIP=1
  else
    echo "reconcile-attestations: $ORPHANED." >&2
    echo "  The ledger is bound to a history this repository no longer contains," >&2
    echo "  which a rename or a history rewrite will do. Nothing here is recoverable" >&2
    echo "  by retrying: the commits it attests are gone." >&2
    echo "  To archive the superseded chain and start a new one at the current tip:" >&2
    echo "    OTITO_ATTEST_RESET_LEDGER=1 bash scripts/reconcile-attestations.sh" >&2
    echo "  or run the Post-merge audit attestation workflow by hand with reset_ledger=true." >&2
    exit 1
  fi
fi

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
  RANGE="$LAST_SHA..$TARGET_SHA"
else
  RANGE="$TARGET_SHA"
fi

if [ "${RESET_TO_TIP:-0}" = "1" ]; then
  COMMITS="$TARGET_SHA"
else
  COMMITS="$(git rev-list --first-parent --reverse "$RANGE")"
fi
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
