# Dual-Mode Thesis & the Complementary Stack

> _Why otito is the deterministic half of a probabilistic agent stack — and why both modes belong._

This document maps a widely-shared primer on AI decision-making onto otito's existing
surface, then turns it into a concrete, prioritised roadmap. It mirrors
[the harness thesis](../07-harness-thesis/README.md),
[the convergence thesis](../09-convergence-thesis/README.md), and
[the determinism thesis](../11-determinism-thesis/README.md): take a video, name what
otito has quietly already built, and let the naming sharpen the product.

The source is _Probabilistic vs. Deterministic Models Explained in Under 2 Minutes_
([video](https://www.youtube.com/watch?v=U8kuVAvam50)). The argument is introductory
but architecturally decisive: AI systems use two modes. **Deterministic** models follow
fixed rules and reach definite conclusions — if this, then that. **Probabilistic**
models decide from likelihoods — the same input can yield different outputs, which is
often a feature for language, vision, and judgment under uncertainty.

The video's conclusion is not "pick one." It is **use each mode where it fits**:
deterministic for clear-cut rules, probabilistic for complex, ambiguous tasks. That is
the onboarding explainer for why otito sits beside an LLM instead of replacing one.

## The thesis in one line

> Coding agents are **probabilistic**: they interpret, generate, and adapt. Merge
> readiness is **deterministic**: same repo state, same rules, same verdict. A
> trustworthy agent stack uses **both modes on purpose**, with a bright line between
> generation and verification. Native model harnesses own generation. Otito owns
> verification.

otito **is** the deterministic mode for repository work: rules, gates, receipts, and
git facts, not token sampling. It integrates with Codex, Claude Code, Gemini, and
Cursor rather than competing with their agent loops.

## What lines up — otito is already the deterministic mode

| Video's claim | otito's existing answer |
| --- | --- |
| Deterministic: fixed rules, definite conclusions | `review_gate`, `review_verdict`, `convergence_score`, and code maps are **rule-driven** outputs on repo facts. |
| Probabilistic: likelihoods, variability, adapts to new data | Agents and LLMs handle scoping, coding, and explanation. otito does not compete with that role. |
| "Which is better?" → depends on the task | otito's workflow separates tasks: **context and gates before/after** the probabilistic edit, not instead of it. |
| Clear-cut rules → deterministic (e.g. square root) | Path risk classification, secret heuristics, validation command presence, and policy profiles are **clear-cut checks** (`src/lib/risk-paths.js`, `src/lib/pass-local.js`). |
| NLP / ambiguity → probabilistic | Task phrasing, implementation choices, and refactors stay with the agent. otito grounds the agent; it does not write the patch. |
| Autonomous vehicles: red light = deterministic, pedestrians = probabilistic | **Red lights:** gate checks, required validation, owner warnings. **Pedestrians:** interpreting the task, choosing an approach, drafting the diff. otito owns the red lights. |
| You may program both approaches | otito exposes **procedures** (CLI + MCP skills) for the deterministic path and stays **model-agnostic** so any probabilistic host can call them. |

The useful observation: this video is the friendly 101 version of
[the determinism thesis](../11-determinism-thesis/README.md). That doc explains *why*
LLM outputs vary at scale. This doc explains *what to do about it architecturally*:
**do not ask the probabilistic layer to behave like the deterministic one.**

## Six lessons, mapped to otito

### 1. Name the two modes (positioning)

The determinism doc owns "models vary; harnesses don't." This doc owns the **split
itself**: *probabilistic generation, deterministic verification.*
[The trust harness thesis](../14-trust-harness-thesis/README.md) then names **which
harness** sits on the deterministic side: independent merge evidence, not the generic
agent loop.

That reframes otito from "anti-AI" to "complementary." Teams already accept that
chatbots are probabilistic. otito makes the same acceptance explicit for coding agents:
let the model judge and draft; let the harness rule and measure. Native hosts generate.
Otito attests.

### 2. Place deterministic work at guarantees

The video's examples — square roots, red lights — are places where variance is a defect.
Software delivery has the same list:

- Did required validation commands exist?
- Did the diff touch risk-sensitive paths?
- Did the change match the stated task?
- Can a reviewer recompute the evidence?

Those are otito's gates and convergence score, not prompts. A probabilistic model can
*assist* a human on any of these questions; it cannot *be* the authority without
recreating the failure mode the video describes.

### 3. Place probabilistic work at judgment

NLP, image recognition, ambiguous requirements — the video assigns these to
probabilistic models. In agent workflows that maps to:

- interpreting a vague ticket
- choosing between implementation options
- explaining a tradeoff to a reviewer

otito deliberately does **not** try to replace these steps. `context_pack` narrows the
search space; it does not pick the algorithm. That restraint keeps otito in the mode
where it is strongest.

### 4. Ship a hybrid workflow, not a pure model loop

The video's implicit architecture is **both modes in sequence**. otito's shipped workflow
already matches it:

```text
Request → context (deterministic facts)
       → scoped change (probabilistic agent)
       → validation (deterministic commands)
       → review evidence (deterministic gate + convergence)
       → human decision
```

This is the same complementarity Nintex and others describe for automation: structure
and accountability from rules; intelligence and adaptability from models. otito is the
structure layer for repos.

### 5. Procedures are the deterministic interface

The video ends by inviting viewers to "program your own model and decide which approach
to use." otito's answer is already procedural: `otito context`, `otito gate`,
`otito converge`, and the `codex/skills/otito-*` skills are **user-invoked deterministic
steps** in a probabilistic host. That matches the harness doc's "procedures over
abilities" lesson — heavy deterministic work should be deliberate, not ambient model
guesswork.

### 6. Hold the line against mode collapse (what this is NOT)

The failure mode this video warns about, applied to agents, is **mode collapse**: using
one probabilistic loop for everything, including merge approval.

otito is not:

- a probabilistic reviewer pretending to be a gate
- a deterministic code generator replacing the agent
- an argument that all AI should be rule-based
- an argument that all verification should be fuzzy

The differentiated bet: **be the deterministic mode, explicitly, beside probabilistic
agents** — the if-this-then-that layer for repository trust.

## How the thesis docs fit together

```text
Trust harness (docs/14)         ->  which harness is durable; integrate with native loops
Dual-mode (this doc)            ->  two modes, complementary roles
Prompt determinism (docs/13)    ->  you cannot collapse modes via prompting
Determinism (docs/11)           ->  why the probabilistic mode cannot self-verify
Harness (docs/07)               ->  what you still control; AX as a cost property
Convergence (docs/09)           ->  how you measure intent vs. execution deterministically
```

Read this doc first for onboarding. Read
[the trust harness thesis](../14-trust-harness-thesis/README.md) when the question is
whether generic agent loops still matter. Read
[the prompt determinism thesis](../13-prompt-determinism-thesis/README.md) when someone
proposes "just tell it not to randomize." Read determinism next for the engineering depth on
LLM variance. Read harness and convergence when designing workflows and gates.

## Priorities

| Priority | Work | Why first | Effort |
| --- | --- | --- | --- |
| **P0** | Dual-mode positioning (lessons 1, 4) | Low cost; reframes otito as complementary, not adversarial, to LLMs | Low — this doc |
| **P0** | Workflow diagram on landing / README (lesson 4) | Makes the hybrid stack visible in one glance | Low |
| **P1** | Mode boundary in MCP docs (lesson 2, 5) | Hosts mixing browser/search tools need explicit "deterministic attestation" vs "probabilistic input" | Low |
| **P1** | Convergence gate in CI (ties to docs/09) | Turns the deterministic mode load-bearing at merge time | Medium |
| **P2** | Task-type hints in `context_pack` (lesson 3) | Flag when a query is judgment-heavy vs rule-heavy so operators know where mode collapse risk is high | Medium |

## What this is NOT

Not a claim that deterministic AI is universally superior. Not a replacement for
probabilistic agents on creative or ambiguous work. Not a single-mode product. The
differentiated bet is **complementarity**: otito is the deterministic guarantees layer
in a stack that still needs probabilistic generation.

## Sources

- _Probabilistic vs. Deterministic Models Explained in Under 2 Minutes_ —
  <https://www.youtube.com/watch?v=U8kuVAvam50>
- otito source referenced above: `src/lib/pass-local.js`, `src/lib/risk-paths.js`,
  `src/lib/converge.js`, `src/lib/review.js`, `src/lib/context-engine.js`,
  `codex/skills/otito-context/`, `codex/skills/otito-review/`
- Companions: [Trust Harness Thesis](../14-trust-harness-thesis/README.md),
  [Determinism Thesis](../11-determinism-thesis/README.md),
  [Harness Thesis](../07-harness-thesis/README.md),
  [Convergence Thesis](../09-convergence-thesis/README.md),
  [Prompt Determinism Thesis](../13-prompt-determinism-thesis/README.md)
