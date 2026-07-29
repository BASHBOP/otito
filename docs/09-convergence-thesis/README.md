# Convergence Thesis & Drift as Evidence

> _Why otito is already the deterministic, out-of-band verifier the "prove software
> sanity" argument demands — and the one capability it is missing to close the loop._

This document maps a second widely-shared argument about agentic engineering onto
otito's existing surface, then turns it into a concrete, prioritised roadmap. It mirrors
[the harness thesis](../07-harness-thesis/README.md): take a video, name what otito has
quietly already built, and let the naming sharpen the product.

The source is ThetaDriven's _Mathematically Proving Software Sanity: Beyond AI and LLMs_
([video](https://www.youtube.com/watch?v=_Ioh8tGAnJI)). Its vocabulary is deliberately
provocative (Rice's theorem, "drift," "receipts," an orthogonal "i-axis"). Strip the
showmanship and the engineering claim underneath is one otito is unusually well placed to
ship.

## The thesis in one line

> A system cannot prove a property of itself, so an LLM cannot certify its own output. The
> only thing you can trust is an **out-of-band, deterministic verifier** that measures the
> **gap between what was asked and what was actually done** — and stamps that measurement as
> tamper-evident evidence.

Two of those three pillars are otito today. The third is a small, well-supported addition.

## What lines up — otito is already the verifier

| Video's claim | otito's existing answer |
| --- | --- |
| "A system cannot prove a property of itself" → you need an out-of-band checker | otito's whole bet (`docs/07`, "What this is NOT"): **deterministic static analysis a model cannot do for itself**. `review_gate` is non-model on purpose. |
| The model shouldn't grade its own homework | `review_gate` / `review_verdict` are deterministic; the gate node sits _outside_ the agent loop. |
| Verification must be the **orthogonal axis** (their "i-axis"), perpendicular to the thing it measures | otito runs in a different substrate from the agent: static code-map + git facts, not the agent's own narration. |
| "Receipts" — tamper-evident, **recomputable** attestations of a state | otito's "durable evidence" framing + `review_verdict`. Recomputability is implicit; the video says make it explicit. |
| Evals "don't work on a prion" — verification is worthless without grounding | `context_pack` grounds every check in real repo facts (files, imports, owners, tests), never the model's memory. |

The uncomfortable, useful observation: otito has been building this thesis without naming
it. Naming it — **the deterministic convergence verifier** — is free positioning, the same
move the harness doc made.

## The gap — otito never scores intent vs. execution

The video's sharpest, most buildable idea is _Geometric Driven Development_:

> "The goal prompt is the document read forward, the commit log is the same document read
> backward, and the convergence grade is the measured distance between the two. Zero
> distance is done."

otito holds **both halves of that distance and never computes it**:

- **Intent** — the `query` you already pass to `otito context` / `otito impact` is the
  stated goal. The engine turns it into predicted owner files, concepts, and risk flags
  (`generateImpact` → `concepts`, `topFiles`, `risks` in `src/lib/impact.js`).
- **Execution** — `validateAgainstDiff` (already in `src/lib/impact.js`) diffs the prediction
  against the actual `git diff`, producing `confirmedDirect`, `confirmedRelated`,
  `unconfirmedCandidates`, `missedChangedFiles`, and a coarse `verdict`
  (`confirmed` | `partial` | `missed`).

So the substrate exists. What's missing is to (1) express that comparison as a single
**convergence score** with a **drift breakdown**, and (2) emit it as a **recomputable
receipt** — the video's two demands, landing exactly on machinery otito already ships.
This is the same composition move as the AX score: no new analysis, a new layer over
`generateImpact`'s `validation` block plus `risk-paths` and `codeowners`.

## Lessons, mapped to otito

### 1. Name the convergence verifier (positioning)

The harness doc claimed the word "harness." This claims a sibling: otito is the
**out-of-band convergence verifier** for agent work — the thing that answers "did the change
match the ask, and what slipped in that nobody asked for?" deterministically. It is the
honest, un-hyped version of "mathematically proving software sanity": not a proof, a
**measurement**, computed where the agent can't fake it.

### 2. Turn `validateAgainstDiff` into a convergence score

Promote the existing predicted-vs-actual comparison from a three-value `verdict` to a
0–100 **convergence score** with named sub-scores (coverage of intent, scope discipline,
risk-zone alignment). High score = the diff did what the task implied and little else; low
score = drift. Spec: [convergence-score-spec.md](./convergence-score-spec.md).

### 3. Treat unrequested changes as first-class drift

`missedChangedFiles` (files that changed but no part of the task predicted) is exactly the
video's "scope drift" — the change nobody asked for, the place bugs and supply-chain edits
hide. Surface it as its own signal, weighted by `classifyPath` risk (a drifted edit to an
auth or money-flow file should tank the score harder than a drifted README).

### 4. Make evidence recomputable — the "receipt"

The video's strongest practical idea: an attestation is only trustworthy if anyone can
**recompute it** from the same inputs and get the same hash. Emit a deterministic receipt —
`hash(repo commit + task + engine version + score + drivers)` — that a CI step (or a human)
can regenerate and compare. This upgrades "durable evidence" from a phrase to a verifiable
artifact, and it composes with `review_verdict`'s auto-merge signal: a merge is eligible only
if a freshly recomputed receipt matches the one on the commit.

### 5. Close the loop in git — convergence as a gate

GDD stamps the convergence grade on each commit. otito already scaffolds CI (`init`) and a
deterministic gate (`review_gate`). Wire the convergence score in: a post-commit / pre-merge
check that reads the task (from the PR body, commit trailer, or `--task`), recomputes
convergence against the diff, and fails the gate below a configurable floor. "Zero distance
is done" becomes a CI threshold, not a vibe.

### 6. Hold the line against the hype (what this is NOT)

The video oversells — universal drift constants, on-chip "sanity proofs," insurability. We
borrow the **engineering core** (out-of-band measurement of the intent/execution delta,
recomputable receipts) and drop the metaphysics. otito does not "prove software sane,"
predict a drift constant, or claim a halting-problem result. It computes a deterministic,
recomputable **distance between a stated task and a diff** — useful precisely because it is
modest and reproducible.

## Priorities

| Priority | Work | Why first | Effort |
| --- | --- | --- | --- |
| **P0** | Convergence score over `validateAgainstDiff` (lessons 2, 3) | Reuses shipped `impact.js` validation + `risk-paths`; unique; deterministic | Medium — see [spec](./convergence-score-spec.md) |
| **P0** | Recomputable receipt + positioning (lessons 1, 4) | Low cost; turns "durable evidence" into a verifiable artifact | Low–Medium |
| **P1** | Convergence gate in CI / `review_gate` (lesson 5) | Makes the score load-bearing, not decorative | Medium |
| **P2** | Drift trend over time (ties to `docs/07` lesson 7 scheduled review) | A repo's convergence history is a self-improving-loop signal | Medium |

## What this is NOT

Not a model. Not a proof. Not an autonomous merge bot, and not a claim that any number
"certifies" correctness. The differentiated bet is the same as the harness thesis, viewed
from the other end: **deterministic, recomputable measurement of the gap between intent and
execution — the half of verification a model structurally cannot do for itself.**

## Sources

- ThetaDriven, _Mathematically Proving Software Sanity: Beyond AI and LLMs_ —
  <https://www.youtube.com/watch?v=_Ioh8tGAnJI>
- ThetaDriven blog (Geometric Driven Development, drift, receipts) —
  <https://thetadriven.com/blog>
- otito source referenced above: `src/lib/impact.js` (`generateImpact`,
  `validateAgainstDiff`), `src/lib/review.js`, `src/lib/risk-paths.js`,
  `src/lib/codeowners.js`, `src/lib/ax.js`
- Companion: [Harness Thesis](../07-harness-thesis/README.md)
