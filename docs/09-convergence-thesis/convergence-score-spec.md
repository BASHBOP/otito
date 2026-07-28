# Spec: Convergence Score

**Status:** Implemented — task mode (`repoctx converge`) + `convergence_score` MCP tool, including exact change-subject receipt v2.
**Depends on:** `src/lib/impact.js` (`generateImpact`, `validateAgainstDiff`),
`src/lib/risk-paths.js` (`classifyPath`, `isSecretPath`, `RISK_FLAGS`),
`src/lib/tools.js` (`runCommand`), `node:crypto`.
**Implementation:** `src/lib/converge.js` (`generateConvergence`, `makeReceipt`),
CLI `repoctx converge`, MCP `convergence_score`, tests in `tests/converge.test.js`.

## 1. Summary

A deterministic 0–100 score for the **distance between a stated task (intent) and the
actual git diff (execution)** — the buildable core of the convergence thesis
([README.md](./README.md)). It is not a proof of correctness; it is a reproducible
*measurement*, computed out-of-band where the agent cannot fake it.

```bash
repoctx converge "add Stripe refunds" --base origin/main
```

## 2. Why this is low-risk to build

Every input already exists; convergence is a composition layer, not new analysis:

| Signal | Source (already in repo) |
| --- | --- |
| Predicted owner files for the task (intent) | `generateImpact(query).data.topFiles` — `src/lib/impact.js` |
| Predicted-vs-actual diff comparison | `validateAgainstDiff` (already inside `generateImpact` when `diffBase` is set): `confirmedDirect`, `confirmedRelated`, `unconfirmedCandidates`, `missedChangedFiles` |
| Risk weight of a drifted path | `classifyPath` / `isSecretPath` / `RISK_FLAGS` — `src/lib/risk-paths.js` |
| Exact change subject for receipt v2 | Staged: resolved base + parent commit + `git write-tree`; PR: GitHub repository/number + exact base/head OIDs |
| Precedent for a 0–100 composite + receipt-style evidence | `generateAxScore` (`src/lib/ax.js`), `review_verdict` |

## 3. Score model

Three sub-scores, each 0–100, blended with config-overridable weights (defaults below).

```
Convergence = 0.45 * Coverage        // did the intent happen?
            + 0.35 * Scope           // did only the intent happen?
            + 0.20 * RiskAlignment   // did drift land somewhere dangerous?
```

### 3.1 Coverage (did intent happen?)

```
predictedDirect = confirmedDirect + unconfirmedCandidates
Coverage = predictedDirect > 0 ? 100 * confirmedDirect / predictedDirect : 0
```

Share of the task's predicted owner files that were actually changed. A task that grounds to
no predicted files is unmeasurable; Coverage is 0 and a recommendation says so.

### 3.2 Scope (did only intent happen?)

```
onTask = confirmedDirect + confirmedRelated
Scope = changedFiles > 0 ? 100 * onTask / changedFiles : 0
```

Share of the diff the task anticipated (directly or as a related dependency).
`missedChangedFiles` — files that changed but nothing in the task predicted — are scope
drift. An empty diff converges on nothing, so Scope is 0.

### 3.3 Risk alignment (is the drift dangerous?)

```
RiskAlignment = clamp(100 - sum(riskWeight(f) for f in missedChangedFiles), 0, 100)
```

Each unrequested changed file is penalised by its worst risk flag, so a drifted edit to a
secret/auth/money path tanks the score and a drifted README barely moves it.

```
secret 30 · auth/security 25 · money flow 25 · data model 15 · contract 15
· request surface 15 · configuration 10 · default 5
```

### 3.4 Bands

`aligned` ≥ 80 · `partial` ≥ 50 · `drift` < 50.

## 4. Recomputable receipt

The video's "tamper-evident attestation": a hash anyone can regenerate from the same inputs
and compare to the one recorded for a change.

```
inputsHash = sha256( canonical({ engine, task, base, commit, convergence,
                                 subScores, changedFiles, confirmedDirect,
                                 confirmedRelated, unconfirmedCandidates,
                                 missedChangedFiles }) )
id         = "rcpt_" + inputsHash[0:12]
```

The canonical payload **excludes `generatedAt`** and **sorts every file list**, so the
receipt is identity, not timestamp or ordering — the property that makes "recompute and
compare" meaningful in CI.

Calls without an exact subject retain the byte-for-byte v1 canonical payload and receipt
shape for compatibility. A subject-bound receipt uses v2 and adds both of these fields to
the canonical payload:

```text
receiptVersion = 2
subject        = canonical({ kind, repository?, number?, baseSha,
                              parentSha?, headSha?, treeSha? })
```

The two valid subject shapes are:

- `git-index`: resolved base commit, current parent commit, and the tree SHA produced by
  `git write-tree`. Changed paths are captured from `baseSha..treeSha`, so the file list
  and subject come from the same immutable tree. The task-scoring code map is also built
  from raw blobs in that tree, so unstaged source edits cannot change the receipt and
  configured checkout filters cannot execute during scoring. Blobs are analyzed in bounded
  batches, and receipt generation fails closed above 5,000 source files or 64 MiB of eligible
  source. Git paths use NUL-delimited capture so legal whitespace and newline characters
  remain exact. Git diff commands disable local replacement refs, force changed gitlinks to
  remain visible, and fix rename detection at 50% with a finite 1,000-candidate limit. These
  controls prevent repository-local Git configuration from changing the comparison's meaning.
- `github-pr`: target repository, PR number, and the exact `baseRefOid` / `headRefOid`
  returned by GitHub. Exact receipt issuance fails closed if GitHub's `changedFiles` total
  does not equal the returned file list, the local `merge-base(baseSha, headSha)..headSha`
  diff does not match that list, or the local analysis checkout is not the exact, clean
  PR head. Its scoring map is built from `headRefOid`.

`rcpt_` plus 12 hex characters is a display handle. Exact-subject enforcement compares the
full 64-character `inputsHash`. The receipt is hashed but not yet cryptographically signed.

## 5. Output schema

```jsonc
{
  "ok": true,
  "convergenceEngineVersion": "0.1.0",
  "task": "add Stripe refunds",
  "base": "origin/main",
  "subject": {
    "kind": "git-index",
    "baseSha": "a77d38a...",
    "parentSha": "b88e49b...",
    "treeSha": "c99f50c..."
  },
  "repo": { "name": "shop-api", "root": "/..." },
  "convergence": 72,
  "band": "partial",
  "subScores": { "coverage": 80, "scope": 70, "riskAlignment": 60 },
  "drivers": {
    "changedFiles": 4, "predictedDirect": 5,
    "confirmedDirect": ["..."], "confirmedRelated": ["..."],
    "unconfirmedCandidates": ["..."], "missedChangedFiles": ["..."],
    "grounded": true,
    "riskyDrift": [{ "file": "src/auth/login.js", "weight": 25, "flags": ["auth/security"] }]
  },
  "recommendations": ["..."],
  "receipt": {
    "id": "rcpt_f2af2b4b6d5b",
    "algorithm": "sha256",
    "commit": "b88e49b...",
    "inputsHash": "...",
    "receiptVersion": 2,
    "subject": { "kind": "git-index", "baseSha": "a77d38a...", "parentSha": "b88e49b...", "treeSha": "c99f50c..." }
  }
}
```

## 6. Surface

```bash
repoctx converge "<task>" --base origin/main           # task mode, cwd
repoctx converge <repo> "<task>" --base HEAD~1 --json   # explicit repo, machine-readable
repoctx converge "<task>" --base HEAD --staged --json   # exact Git-index subject
```

MCP: `convergence_score` (requires `query` + `base`, accepts `staged`), mirroring
`agent_experience`. This is the deliberate 13th tool on a surface guarded by three count
tests + the migration doc. Because staged capture uses `git write-tree`, it may write Git
object or index-cache metadata without changing source files; the MCP tool is conservatively
not annotated read-only.

## 7. Tests

Pure pieces are unit-tested (`tests/converge.test.js`): frozen v1 compatibility, v2 subject
canonicalisation and validation, sensitivity to tree/base/head changes, and band thresholds.
Staged and PR fixtures verify tree capture, immutable-tree scoring, filter and replace-ref
isolation, rename-configuration independence, NUL-safe paths, merge-base PR scope, complete
file scope, exact head matching, CLI, MCP, and Gate propagation.

## 8. Gate integration

Convergence can now be made load-bearing by passing a task plus either a minimum
score, a receipt, or both to the local/PR gate:

```bash
repoctx gate . --base origin/main --request "update the greeting" --min-convergence 80
repoctx converge . "update the greeting" --base origin/main --staged --json > .dev-context/convergence.json
repoctx gate . --base origin/main --staged --request "update the greeting" --receipt .dev-context/convergence.json
```

The gate recomputes the score from the selected diff and fails when the score is
below the requested floor or when the supplied receipt does not match the current task,
base, and exact change subject. Subject-bound v2 enforcement requires the full inputs hash;
JSON receipt files are accepted and supply that hash automatically. Receipt enforcement is
opt-in so existing gate verdicts remain backward-compatible.

This is an exact **convergence receipt**, not yet a complete Gate attestation. Release checks,
optional local analyzers, base-branch CODEOWNERS, GitHub review state, policy version,
executed validation, and signer identity are not all bound into this envelope yet. In staged
mode the Gate reports that working-tree boundary explicitly.

## 9. Open questions

- **Weights & risk penalties**: defaults are placeholders; calibrate against known-good and
  known-drifted PRs before locking, then move into `config.js`.
- **Ungrounded tasks**: Coverage 0 is harsh for a real change with a vague task description;
  consider a separate `ungrounded` band rather than folding it into `drift`.
- **Calibration**: tune the score weights and risk penalties against known-good and
  known-drifted PRs before making a default floor part of a policy profile.
