# Audit-layer pilot

Turns a repoctx `review_verdict` into an **immutable, hash-chained attestation** bound to a merged commit. Models the "after-merge, complete, tamper-evident" audit layer — the ledger here stands in for an append-only row in `bashbop-api`'s `audit` domain.

## What it proves

Two properties an auditor actually tests:

- **Completeness** — every record is keyed to an exact `mergeSha` (+ base, PR, author). In production this fires from **post-merge CI on `main`**, not on anyone remembering.
- **Tamper-evidence** — each record's `recordHash = sha256(prevHash + body)`, so the records form a chain. Editing any stored field breaks every hash after it.

## Pilot run (PR #75, repoctx v2.3.0)

| field            | value                                                         |
| ---------------- | ------------------------------------------------------------- |
| merge            | `2acaa12` — "feat: convergence score + usage dashboard (#75)" |
| verdict          | **WARN**, confidence 65                                       |
| risk             | medium — flags: configuration, large PR, large file diff      |
| escalated checks | Risk review (WARN), Review state (WARN — local mode)          |
| recordHash       | `df2a5d1d729f…`                                               |

## Commands

```bash
# Attest a merged commit (post-merge CI pipes the review verdict in)
repoctx review . --pr 75 --json > verdict.json   # production: PR mode for full controls
node attest.mjs --verdict verdict.json --merge <sha> --prev <base> \
     --pr 75 --author "Name" --committed <iso>

# Verify the whole chain (CI gate / auditor spot-check)
node attest.mjs --verify        # exits non-zero if any record was altered
```

## CI on main

Pushes to `main` run `scripts/post-merge-attest.sh` via the **Post-merge audit attestation** job in `.github/workflows/repoctx-ci.yml`. The job:

1. Runs `repoctx review` (PR mode when the merge commit references `#NNN`, otherwise diff mode).
2. Appends a hash-chained record to `audit-pilot/ledger.jsonl` (skips if the merge SHA is already attested).
3. Verifies the full chain with `attest.mjs --verify`.
4. Uploads `ledger.jsonl` and `verdict-latest.json` as artifacts.

## Notes / next steps

- This run used **local mode** (`policy: standard`). Production wants **PR mode** (`--pr`) so the gate can verify approvals, CODEOWNERS, and status checks — the "Review state" WARN above is local mode telling you exactly that.
- Sink: POST each record into the existing `audit` domain. Confirm that table is **append-only / immutable** — that single property is what makes this an audit trail rather than just logs.
