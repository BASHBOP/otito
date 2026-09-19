# Calibration Thesis & the Measured Gate

> _Why otito grades its own risk signals against repository history — and why
> that does not require a model._

This document maps a claim from the decision-model conversation onto otito's
existing surface, then turns it into a concrete, prioritised roadmap. It mirrors
[the convergence thesis](../09-convergence-thesis/README.md),
[the determinism thesis](../11-determinism-thesis/README.md), and
[the trust harness thesis](../14-trust-harness-thesis/README.md): take a source,
name what otito has quietly already built, and let the naming sharpen the
product.

The source is TypeSafe's System One launch
([announcement](https://typesafe.ai/blog/introducing-system-one-models-and-jev),
[concepts](https://docs.typesafe.ai/concepts/system-one)). Its argument is that
software should not ask a model for prose and then parse it; it should ask
narrow typed questions and receive **calibrated probabilities** — numbers
trained against outcomes, so a 0.9 means roughly nine times in ten. The
accompanying guidance is equally pointed: route on confidence, escalate what
falls below a threshold, and let deterministic code keep control flow.

The obvious reading is "otito should call that model." The useful reading is the
question it raises about otito itself:

> **Is otito's own risk score calibrated?**

Today, no. It had never been checked — and the first attempt to check it,
recorded below, says more about the measurement than about the score.

## The thesis in one line

> A risk level that has never been compared to an outcome is a heuristic wearing
> a number. otito's evidence is already deterministic and replayable;
> calibration makes it **accountable** — every flag carries a hit rate measured
> on this repository's own history.

## What lines up — otito already has the substrate

| Calibration needs | otito's existing answer |
| --- | --- |
| A signal worth grading | `inferRisk` flags and level (`src/lib/pr-review.js`), `classifyPath` (`src/lib/risk-paths.js`) |
| Ground truth without a labelling budget | Git history: reverts, follow-up fixes to the same lines, CI outcome |
| Inputs that recompute identically | The gate is a pure function of repo state ([determinism thesis](../11-determinism-thesis/README.md)) |
| A tamper-evident identity per evaluation | Receipts over canonical, timestamp-free payloads (`src/lib/converge.js`) |
| Somewhere to publish the numbers | [Evaluation guide](../EVALS.md) and the `eval:accuracy` / `eval:harness` / `eval:gate` scripts |
| Dimensions to segment by | CODEOWNERS, risk paths, file kinds, code map fan-out |

Nothing here needs a network, a key, or a vendor. The measurement is the same
kind of object otito already ships: a deterministic function of repository
state, recorded in a receipt.

## What is asserted today

`inferRisk` sums hand-chosen weights — request surface +2, frontend/backend
contract +2, data model +3, auth/security +3, money flow +3, configuration +2,
large file diff +2, large PR +2, no test files changed +2, open discussion up to
+3, tests present −1 — and then cuts the total into bands at **≥ 9 high** and
**≥ 4 medium**.

Every one of those numbers was chosen by judgement. That is a perfectly good way
to start, and a poor thing to leave permanently unexamined. The gate is
reproducible, which means a wrong weight is reproducibly wrong.

## The method

### 1. Outcomes, defined deterministically and reported separately

Three proxies, each computable from git alone:

- **Reverted** — a later commit that reverts this one (revert trailer or
  recorded sha).
- **Repaired** — a later commit within a bounded window that touches the same
  files, overlapping the same lines, and classifies as a fix.
- **Rejected** — in PR mode, a failing required check or a changes-requested
  review on the head sha.

These are proxies, not truth. A refactor that revisits the same lines is not a
repair; a revert can be a product decision. They are therefore reported
**separately and named**, never merged into a single "bug" label.

### 2. The backtest

Walk the repository's own history. For each commit (or merged PR), recompute the
risk flags and level from the state *at that time*, then join to the outcomes
above. Local, offline, and replayable — the same properties the gate already has.

### 3. The metrics

Per flag: base rate, hit rate, and lift over base rate. Per level: the confusion
matrix, and the ordering check that actually matters — are `high` changes
empirically worse than `medium`, and `medium` worse than `low`? A flag that
fires often and predicts nothing is noise; a flag that fires rarely and predicts
strongly deserves more weight than it has.

The per-flag hit rate is itself an empirical probability, P(outcome | flag).
That is calibration, arrived at without a model.

### 4. The calibration receipt

Same discipline as the convergence and validation receipts: a canonical,
timestamp-free payload recording the commit range, the window, the outcome
definitions, the counts, and the resulting rates — so a number in a README can
be traced to the run that produced it.

## First measurement (2026-09-19)

A throwaway prototype ran the `repaired` proxy over this repository — 283
commits since 2026-05-18, 192 non-merge, 152 scoreable — using a deliberately
weaker join than the one specified above: same file, not same lines.

**`reverted` has no events.** Not one revert in the repository's history, so
that proxy cannot be validated here in either direction.

**A file-level `repaired` join measures co-change, not repair.** The base rate
tracks the window almost linearly:

| Window | 3 days | 7 days | 14 days | 30 days |
| --- | --- | --- | --- | --- |
| Repaired | 22.9% | 30.1% | 54.6% | 71.2% |

A defect signal should not triple as the window widens. Wait long enough in an
active repository and some fix touches every file. This is the evidence that the
line-overlap requirement above is load-bearing rather than decorative.

**This repository cannot calibrate this repository.** Per-flag counts:

| Flag | n | Repaired | Lift |
| --- | --- | --- | --- |
| configuration | 89 | 64.0% | 1.17x |
| auth/security | 2 | 50.0% | 0.92x |
| data model | 3 | 33.3% | 0.61x |
| money flow | 1 | 0.0% | — |
| (no flag) | 63 | 41.3% | 0.76x |

Every lift sits within noise of 1x, and the three flags the gate weights most
heavily carry n = 2, 3 and 1. Nothing can be concluded about them from this
corpus, in either direction.

One finding survives the sample-size problem: `configuration` fires on 89 of the
152 scoreable commits — 59% — contributing +2 to the risk score nearly every
time. A flag that fires on most changes carries little information whatever
calibration eventually says about it.

## Second corpus (2026-09-19)

The `configuration` finding above was the one result the first measurement could
support, so it was the first thing checked against a second repository:
`bashbop-api`, a production service with **2,680 commits, 2,303 non-merge, 1,064
scoreable** — seven times otito's corpus.

It reproduces, and sharpens.

| | otito | bashbop-api |
| --- | ---: | ---: |
| Scoreable commits | 152 | 1,064 |
| `configuration` fires on | 63.2% | **56.8%** |

A flag firing on well over half of all changes is therefore not an artifact of
otito's own young, chore-heavy history. Decomposing each firing by its sole
cause says what is actually driving it:

| Sole cause of the firing | bashbop-api | otito |
| --- | ---: | ---: |
| Dependency manifest / lockfile | **83%** | 61% |
| CI workflow | 4% | 18% |
| First-party application config | 6% | 4% |
| Mixed causes | 6% | 15% |

`configuration` is, in practice, a dependency-bump detector. On bashbop-api,
five firings in six are a lockfile or a manifest and nothing else.

Two caveats keep this honest. This is a **base-rate measurement, not a
calibration** — no outcome proxy was joined against the bashbop-api corpus, so
it says how often the flag fires and on what, never whether those commits were
worse. And the corpus is a second repository, not a representative sample of
repositories; two is better than one and still not many.

### What was changed, and what was not

The loose path matching that contributed to the rate was narrowed — `"config"`,
`"lock"` and `"env"` matched as bare word tokens, and `"package.json"` as a raw
substring, so ordinary source modules and every nested fixture manifest flagged.
Anchoring those removed 20 of 35 matching paths on otito and 7 of 58 on
bashbop-api, with nothing newly matched and no risk band changed in either.

The rate barely moved: 65.1% → 63.2% on otito, 56.8% → 56.7% on bashbop-api.

That is the useful part of the result. The breadth was real and worth fixing,
but it was never what made the flag fire on most changes. **Dependency-manifest
churn is**, and separating it — whether by excluding manifests from
`configuration`, which `inferRisk` already classifies as kind `dependency` and
already excludes from `behaviorFiles`, or by giving dependency changes a flag
and a weight of their own — remains a weight decision, which this document
holds to the same standard as every other: measured first, reviewed as a code
change, never tuned automatically. Excluding manifests would move 37 of otito's
152 commits down a band, all medium to low.

## What changes because of it

1. **Weights stop being folklore.** Changing one becomes a reviewed code change
   justified by a measurement, not a preference.
2. **Policy profiles get an honest basis.** `high-risk` can require the flags
   that demonstrably predict trouble in that repository.
3. **The claim upgrades.** "Deterministic" becomes "deterministic and measured"
   — and unlike a benchmark, it is measured on the user's own history, which no
   competitor can copy.

## Why not simply call a calibrated model?

Because the dependency buys an opinion where otito sells evidence. A vendor's
probabilities are calibrated against its training outcomes, not against this
repository's. Adding a hosted call also trades the product's clearest sentence —
local-first, model-agnostic, no model calls in the core path — for a qualified
version of it.

If the backtest later exposes a blind spot that path rules genuinely cannot
close, that is the moment to revisit, with a measured job for the signal to do.
The boundary contract for that day — ratchet-only escalation, an allowlisted
payload, a receipt over the questions and answers — is written and parked on a
branch rather than merged, so the decision stays explicit instead of
incremental.

## Priorities

| Priority | Work | Why first | Effort |
| --- | --- | --- | --- |
| **P0** | Line-overlap join, plus a minimum-sample rule that refuses to publish a rate beneath it | The first measurement showed both are load-bearing, not refinements | Medium |
| **P0** | A multi-repository corpus to measure against | One young repository cannot produce enough events to conclude anything. A second repository (1,064 scoreable commits) now exists for base rates; outcome proxies still need it | Medium |
| **P1** | `otito calibrate` over that corpus — per-flag hit rate and lift | Turns the risk score from assertion into measurement | Medium |
| **P1** | Calibration receipt + fixture-based eval in CI | Keeps the numbers reproducible and offline | Medium |
| **P2** | Publish the numbers in the [evaluation guide](../EVALS.md) | Only once a corpus can support them | Low |
| **P2** | Revisit `inferRisk` weights and band thresholds as a reviewed change | Only defensible once measured | Medium |
| **P2** | Reconsider an external calibrated signal | Only if a measured blind spot survives path rules | Low |

## How the thesis docs fit together

```text
Determinism (docs/11)     ->  why the model cannot verify itself
Trust harness (docs/14)   ->  why independent merge evidence is the product
Convergence (docs/09)     ->  how intent vs. execution is measured deterministically
Calibration (docs/17)     ->  whether otito's own signals earn the weight they carry
```

Read determinism first for why the gate is outside the model loop. Read this one
when the question is "but is the gate any good?"

## What this is NOT

Not a bug predictor. Not a model, and not a route to one. Not automatic weight
tuning — a measured weight is still a human-reviewed code change. Not a claim
that git history is ground truth; it is a set of named proxies, each with known
failure modes. And not a new reason to block a merge: calibration grades the
signal, it does not become one.

## Sources

- TypeSafe AI, _Introducing System One Models & Jev_:
  <https://typesafe.ai/blog/introducing-system-one-models-and-jev>
- TypeSafe AI, _System One_ concepts and calibrated decisions:
  <https://docs.typesafe.ai/concepts/system-one>
- TypeSafe AI, _How to build with System One_ (confidence thresholds, atomic
  questions): <https://docs.typesafe.ai/concepts/how-to-build-with-system-one>
- otito source referenced above: `src/lib/pr-review.js`, `src/lib/risk-paths.js`,
  `src/lib/converge.js`, `src/lib/policy.js`
- Companions: [Convergence Thesis](../09-convergence-thesis/README.md),
  [Determinism Thesis](../11-determinism-thesis/README.md),
  [Trust Harness Thesis](../14-trust-harness-thesis/README.md),
  [Evaluation Guide](../EVALS.md)
