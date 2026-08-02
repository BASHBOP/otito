# otito Evals

otito ships three evals. They answer different questions and must not be
confused:

| Eval | Entry point | Question it answers |
|---|---|---|
| Token-savings | `runEval(repoPath)` | _Is the context pack **smaller** than a naive file dump?_ |
| Accuracy | `runRetrievalEval()` | _Is the context pack **right** — does it surface the files an agent needs, and does the risk classifier label paths/queries correctly?_ |
| Harness execution | `runHarnessExecutionEval()` | _Do the encoded setup and validation commands Otito inferred actually run?_ |

The token-savings eval is necessary but not sufficient: a randomly-ranked pack
saves exactly as many tokens as a perfect one. The accuracy and harness
execution evals close distinct gaps in that evidence.

## What the corpus measures

The corpus lives at `evals/corpus.json` and has two
case types.

### Retrieval cases

Each retrieval case runs `generateContextPack(query)` against a fixture repo and
scores whether the labeled files land in `primaryFiles`:

- **precision@k** — of the files the pack returned (capped at `k`), how many
  were relevant. The denominator is _what was returned_, not `k`, because
  otito packs are intentionally tiny (often 1–3 files); dividing a single
  correct hit by a fixed `k=5` would score a perfect one-file pack at 0.2 and
  punish concision.
- **recall@k** — of the relevant files, how many appeared in the top `k`.
- **MRR** — reciprocal rank of the first relevant file (1.0 if the top hit is
  relevant, 0 if none appear in the top `k`).

A case **passes** when every `expectedPrimary` file is in the top `k` and, when
`expectedAnyOf` is given, at least one of those files appears anywhere in the
pack (`primaryFiles` **or** `relatedFiles` — `expectedAnyOf` encodes
related-file and route↔client pairing expectations, which the engine surfaces
under `relatedFiles`).

Pure-fallback cases (`expectedPrimary: []`) assert only that the pack falls back
gracefully to a non-empty set — their precision/recall/MRR are reported as
`null` and excluded from the aggregate.

The fixtures exercise: cross-language naming (TypeScript + Python + Go),
plural/singular folding (`users service` → `users_service.py`), route-shaped
queries, error-message-shaped queries that should fall back gracefully, and
multi-repo route↔client pairing.

### Risk cases

Each risk case exercises the shared risk vocabulary in
`src/lib/risk-paths.js` so the recently-fixed false
positives/negatives surface in CI, not in production review output. The `mode`
field selects the predicate:

| `mode` | Predicate | Concept labels |
|---|---|---|
| `query` | `conceptsFromQuery(query)` | risk-flag names (`money flow`, `auth/security`, …) |
| `path` | `classifyPath(path)` | risk-flag names |
| `gate` | `isGateRiskPath(path)` | `["gate"]` if it gates a merge, else `[]` |
| `secret` | `isSecretPath(path)` | `["secret"]` if it is a secret file, else `[]` |

`expectedConcepts` must all be present; `notExpectedConcepts` must all be
absent. Encoded regression guards include:

- `fix payload parsing` → **not** money flow (the `pay` substring must not match)
- `roles.guard.ts` → auth/security, **not** money flow
- `tests/checkout.spec.ts` → **no** merge-gate flag
- `config/dev.environments.ts` → **not** a secret (`.env` substring must not match)

### Harness execution cases

The `harnessExecution` corpus encodes a small, reviewed fixture repository and
the exact commands Otito must infer from it. The current Node fixture proves:

- `npm install`
- `npm test`
- `npm run typecheck`
- `npm run build`

For every expected command, the runner first verifies that it appears in the
right harness group, then executes it in a temporary copy of the fixture. The
source fixture is never mutated. It accepts only ordinary `npm`, `pnpm`,
`yarn`, or `bun` install/test/run forms, has a 60-second timeout per command,
and disables lifecycle scripts during the install probe. It never executes a
command inferred from a customer repository.

The current dependency-free Node fixture uses `node --check` behind its
`typecheck` script. That proves command inference and execution; it does not
claim TypeScript compiler coverage. Add a dedicated TypeScript fixture when
testing compiler semantics is the goal.

This is execution evidence for the encoded fixture commands, not a claim that
every command in every possible harness is safe or runnable. Add another small
fixture when extending coverage to another ecosystem or command form.

## How thresholds work

The corpus header carries a `thresholds` block so the pass/fail bar is tunable
without touching code:

```json
"thresholds": {
  "retrieval": { "precisionAtK": 0.85, "recallAtK": 0.9, "mrr": 0.9 },
  "risk": { "accuracy": 0.95 }
}
```

The runner computes the aggregate metrics, compares each against its floor, and
sets `exitCode` to `0` only when **every** check passes. Thresholds are set to
**current-baseline-minus-slack**: high enough that a real regression trips the
gate, low enough that the suite is green today. (At the recorded baseline a
single risk-case regression drops accuracy to 15/16 = 0.9375, below the 0.95
floor — so the gate catches it.)

## Current baseline

Recorded **2026-08-02** by running `runRetrievalEval()` against the committed
corpus (21 retrieval + 16 risk cases):

```
| Group     | Metric       | Value | Threshold | Pass |
|-----------|--------------|------:|----------:|:----:|
| retrieval | precisionAtK | 0.867 |      0.85 | yes  |
| retrieval | recallAtK    | 1.0   |      0.9  | yes  |
| retrieval | mrr          | 1.0   |      0.9  | yes  |
| risk      | accuracy     | 1.0   |      0.95 | yes  |

Retrieval: p@5=0.867, r@5=1.0, mrr=1.0 (21/21 cases pass)
Risk:      accuracy=1.0 (16/16 cases pass)
Overall:   PASS (exit 0)
```

precision@5 is below 1.0 because some pairing queries (e.g. `fix the rsvp
button`) legitimately return two primary files when only one is labeled
`expectedPrimary`; the second is a correct related file, so this is expected
headroom rather than a defect.

## How to add a case

1. **Pick or add a fixture.** Reuse a name under `fixtureRoots` in
   `evals/corpus.json`, or add a small synthetic repo under `evals/fixtures/`
   and register it in `fixtureRoots`. Keep fixtures tiny and synthetic — a few
   files that exercise one behavior. Do **not** add a `.otito/` cache to a
   fixture; the runner copies each fixture to a temp dir and regenerates the map
   from source so the committed fixtures are never mutated.

2. **Add the case.**

   Retrieval:

   ```json
   {
     "name": "shop-refund-payment",
     "query": "refund a payment",
     "repoFixture": "shop-api",
     "expectedPrimary": ["src/payment/checkout.service.ts"],
     "expectedAnyOf": ["src/payment/stripe.webhook.ts"]
   }
   ```

   Multi-repo cases use `"repoFixtures": ["shop-api", "web-client"]` and
   namespace expected paths as `"<fixture>/<repo-relative-path>"`.

   Risk:

   ```json
   {
     "name": "query-refund-is-money",
     "mode": "query",
     "query": "refund a payment",
     "expectedConcepts": ["money flow"],
     "notExpectedConcepts": []
   }
   ```

   Harness execution:

   ```json
   {
     "name": "node-install-test-typecheck-build",
     "repoFixture": "harness-node",
     "commands": [
       { "kind": "install", "group": "setup", "command": "npm install" },
       { "kind": "test", "group": "validate", "command": "npm test", "script": "test" }
     ]
   }
   ```

3. **Run it.** `node --test tests/eval.test.js`, or run the runner directly to
   see the scoreboard. If you intentionally changed behavior, re-record the
   baseline above and re-set the thresholds to baseline-minus-slack.

## Running the eval

`runRetrievalEval()` and `runHarnessExecutionEval()` are exported from
`src/lib/eval.js`. Both suites are covered by `tests/eval.test.js`:

```bash
node --test tests/eval.test.js
```

Run the release-gating commands directly with:

```bash
npm run eval:accuracy
npm run eval:harness
```

The CLI equivalents are `otito eval --accuracy` and `otito eval --harness`.
Both exit non-zero on a failed corpus, and `npm run quality` runs both.
