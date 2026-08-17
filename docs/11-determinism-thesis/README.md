# Determinism Thesis & the Harness Boundary

> _Why otito does not try to fix LLM determinism — and what it ships instead._

This document maps a widely-shared argument about LLM non-determinism onto otito's
existing surface, then turns it into a concrete, prioritised roadmap. It mirrors
[the dual-mode thesis](../12-dual-mode-thesis/README.md),
[the harness thesis](../07-harness-thesis/README.md), and
[the convergence thesis](../09-convergence-thesis/README.md): take a video, name what
otito has quietly already built, and let the naming sharpen the product.

The source is Dev with Sordar's _Why LLM Determinism Is So Hard_ (InfoWorld)
([video](https://www.youtube.com/watch?v=lnVRR-SPRr4)). The argument is practical,
not philosophical: even with the same prompt, LLM outputs vary across runs, and the
sources of that variance multiply at scale. The video's conclusion is not "wait for a
better model" but **lower your expectations for model-level determinism** and design
systems that do not depend on it.

That is the onboarding explainer for why a deterministic harness exists at all.

## The thesis in one line

> LLMs are **non-deterministic by construction** — temperature, floating-point math,
> distributed inference, and external data all inject variance. You cannot reliably
> test or trust agent output by re-running the model. You need a **separate,
> deterministic layer** that recomputes the same evidence from the same repo state.

otito **is** that layer for coding agents: local-first, model-agnostic, and
deliberately outside the model loop.

## What lines up — otito is already the answer

| Video's claim | otito's existing answer |
| --- | --- |
| Same input, different output across runs | Do not use the model as the verifier. `review_gate`, `review_verdict`, and `convergence_score` are **non-model** and recompute on the same git state. |
| Temperature and seed are "in theory" fixes | otito never depends on temperature-zero runs. Context, impact, gates, and receipts are **pure functions of repo facts**. |
| Floating-point imprecision creeps into large models | otito's analysis runs on the host in Node.js over static files and git refs, not inside model inference. |
| Distributed hardware makes order non-repeatable | otito runs **locally on one machine** against one checkout. No multi-node inference, no shared queue ordering. |
| External data (search, APIs) adds indeterminism | Default substrate is **local repo inspection** (`repo_inspect`, `context_pack`, code maps). No live web retrieval in the core path. |
| Option 1: sacrifice scale for determinism | otito's local-first design accepts that trade for **verification**, not for generation. |
| Option 2: reduce determinism expectations | otito operationalizes this: expect the harness to be stable; expect the model to vary; **measure the gap** with convergence. |

The uncomfortable, useful observation: the video stops at "reduce expectations."
otito names what that looks like in software delivery — **deterministic merge evidence
and a human decision** — and ships the CLI and MCP tools to produce it.

## Six lessons, mapped to otito

### 1. Name the boundary (positioning)

The harness doc owns "harness." The convergence doc owns "verifier." This doc owns
the **boundary**: *models vary; harnesses don't.*

That is not a slogan against LLMs. It is an engineering split. Generation stays
non-deterministic and useful. Verification, context ranking, gate verdicts, and
convergence receipts stay deterministic. The README already leads with this framing;
this doc gives it a source and a vocabulary for teams arriving from the determinism
conversation.

### 2. Context packs shrink variance without pretending to eliminate it

The video's testing problem — "I ran the same prompt twice and got different code" —
is partly a **context problem**. Agents that grep blindly, read the wrong files, or
hallucinate paths will diverge even at temperature zero.

`otito context` / `context_pack` grounds every run in the same indexed facts: primary
files, related files, tests, patterns, and validation commands. The context engine's
fallback ranking is explicitly deterministic when concept resolution is weak
(`src/lib/context-engine.js`). That does not make the model deterministic, but it
**narrows the search space** so different runs are more likely to touch the same owner
files — the same move as Pocock's "make the codebase easy to change," applied to
retrieval.

### 3. Gates must sit outside the model loop

The video asks how you test a system whose outputs vary. otito's answer is structural:
**never ask the model whether its own change is safe.**

`review_gate` and `review_verdict` run deterministic checks — changed paths, risk
classification, validation command availability, secret heuristics, policy profile —
without calling an LLM. A passing gate is evidence for a human reviewer, not an
automatic merge. That is how you avoid the regressions the video describes when
"same input" tests flake because the model flaked.

### 4. Convergence scores the drift the video leaves open

Lowering expectations is necessary but not sufficient. You still need to know **how
far this run drifted from the ask.**

`otito converge` / `convergence_score` compares stated intent (the task query and
predicted owner files from `generateImpact`) against execution (the actual git diff).
Same repo state + same task + same base ref → same score and receipt
(`src/lib/converge.js`). When the model varies, convergence varies with the **diff**,
not with the model's narration — exactly the out-of-band measurement the video implies
you need.

### 5. Control external indeterminism at the harness edge

Search-augmented agents reintroduce every source of variance the video lists. otito
cannot sandbox a host's browser tools or web search, but it **draws a bright line**
around what it attests to:

- **Deterministic channel:** CLI stdout, MCP JSON-RPC responses, gate verdicts,
  convergence receipts. Telemetry is explicitly forbidden on this channel
  (`docs/10-usage-dashboard`, enforced in `tests/telemetry.test.js`).
- **Side channel:** opt-in usage logs under `~/.otito/`, never mixed into evidence
  output.

Teams that need web-augmented agents should treat otito evidence as authoritative for
**repo and git facts**, and treat everything else as untrusted input — the same
boundary the video draws for search engines.

### 6. Hold the line against false determinism (what this is NOT)

The video notes that better mechanisms may arrive. otito should not over-promise in
that direction. We are not:

- pinning model temperature and calling a workflow "deterministic"
- replaying agent transcripts as proof
- certifying that two agent runs will produce the same patch
- replacing human merge authority with a model-graded gate

The differentiated bet is unchanged: **deterministic static analysis and git facts that
a model cannot produce reliably for itself**, composed into evidence a human can
recompute.

## How the three theses fit together

For the introductory split between probabilistic and deterministic modes, start with
[the dual-mode thesis](../12-dual-mode-thesis/README.md). If someone proposes fixing
variance with prompt settings, read
[the prompt determinism thesis](../13-prompt-determinism-thesis/README.md). Then read
this doc for why LLM variance is structural, not a settings bug.

```text
Trust harness (docs/14)       ->  which harness is durable; integrate with native loops
Dual-mode (docs/12)           ->  two modes, complementary roles
Prompt determinism (docs/13)  ->  you cannot collapse modes via prompting
Determinism (this doc)        ->  why the model cannot be the trust layer
Harness (docs/07)             ->  what you still control; AX as a cost property
Convergence (docs/09)         ->  how you measure intent vs. execution deterministically
```

## Priorities

| Priority | Work | Why first | Effort |
| --- | --- | --- | --- |
| **P0** | Determinism boundary positioning (lessons 1, 6) | Low cost; connects a common onboarding video to otito's core bet | Low — this doc |
| **P0** | Convergence gate in CI (ties to docs/09 lesson 5) | Makes "reduce expectations" load-bearing: drift fails the gate, not the vibe | Medium |
| **P1** | Document deterministic vs. host-dependent surfaces (lesson 5) | Teams mixing MCP browser/search tools need an explicit attestation boundary | Low |
| **P1** | Context-before-edit procedure skills (ties to docs/07 lesson 5) | Shrinks run-to-run variance at the cheapest point in the workflow | Done — `codex/skills/otito-context/` |
| **P2** | Same-task diff stability eval | Track how often repeated agent runs on the same `context_pack` diverge in convergence score — a harness metric, not a model metric | Medium |

## What this is NOT

Not a fix for LLM non-determinism. Not a claim that agents will produce identical
patches. Not a replacement for tests, CI, CODEOWNERS, or human review. The
differentiated bet is the complement to the video's conclusion: **accept model
variance, ship deterministic verification, and keep the merge decision human.**

## Sources

- Dev with Sordar (InfoWorld), _Why LLM Determinism Is So Hard_ —
  <https://www.youtube.com/watch?v=lnVRR-SPRr4>
- otito source referenced above: `src/lib/context-engine.js`, `src/lib/converge.js`,
  `src/lib/review.js`, `src/lib/pass-local.js`, `src/lib/impact.js`,
  `tests/telemetry.test.js`, `tests/context-engine.test.js`
- Companions: [Trust Harness Thesis](../14-trust-harness-thesis/README.md),
  [Harness Thesis](../07-harness-thesis/README.md),
  [Convergence Thesis](../09-convergence-thesis/README.md),
  [Dual-Mode Thesis](../12-dual-mode-thesis/README.md),
  [Prompt Determinism Thesis](../13-prompt-determinism-thesis/README.md)
