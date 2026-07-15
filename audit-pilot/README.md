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

Successful `repoctx CI` runs trigger `.github/workflows/post-merge-attest.yml`. Keeping attestation in a separate `workflow_run` workflow provides two important guarantees:

- ordinary pushes are attested only after the main quality gate passes;
- Dependabot auto-merges are still detected from the completed PR workflow even though merges performed with `GITHUB_TOKEN` do not trigger another push workflow.

The workflow:

1. Resolves the exact merged main commit, ignoring completed PR workflows that have not merged.
2. Restores the latest ledger from the dedicated `audit-ledger` branch.
3. Runs `scripts/reconcile-attestations.sh` to backfill every missing first-parent commit in chronological order.
4. Runs exact diff-mode review for historical gaps and PR-mode review for the newly merged target when its subject references `#NNN`.
5. Appends and verifies the hash chain with `attest.mjs`.
6. Commits the ledger and latest verdict to `audit-ledger`, keeping bot-generated evidence commits off `main`.
7. Uploads commit-specific evidence artifacts for convenient review.

The reconciliation job is serialized, idempotent by merge SHA, and fails if the stored ledger tip is not an ancestor of the requested main commit. A maintainer can also run it manually with the workflow's optional `target_sha` input.

Review exit codes are not verdict validity: a blocking `FAIL` intentionally exits nonzero. The attestation script validates the JSON envelope and records PASS, WARN, or FAIL faithfully; it falls back only when PR review produces no valid verdict.

`ledger-v1.jsonl` preserves the original pilot chain before first-parent completeness was enforced. The canonical `ledger.jsonl` was rebuilt from its unchanged genesis record so the previously skipped `bebc24d` commit and every later main commit are represented in order.

## Notes / next steps

- This run used **local mode** (`policy: standard`). Production wants **PR mode** (`--pr`) so the gate can verify approvals, CODEOWNERS, and status checks — the "Review state" WARN above is local mode telling you exactly that.
- The `audit-ledger` branch is the durable pilot sink. Protect it from force-pushes and deletions; production should additionally POST each record into an append-only audit store.
