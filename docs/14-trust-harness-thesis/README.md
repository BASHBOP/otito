# Trust Harness Thesis & the Commodity Loop

> _Why the generic model harness is becoming infrastructure, and why independent
> merge evidence is the durable product._

This document maps a now-public shift in agent engineering onto otito's existing
surface, then turns it into a concrete, prioritised roadmap. It mirrors
[the harness thesis](../07-harness-thesis/README.md),
[the dual-mode thesis](../12-dual-mode-thesis/README.md), and
[the determinism thesis](../11-determinism-thesis/README.md): take the sources,
name what otito has quietly already built, and let the naming sharpen the product.

The sources are OpenAI's Agents SDK evolution
([post](https://openai.com/index/the-next-evolution-of-the-agents-sdk/)),
OpenAI's harness-engineering write-up from its agent-first experiment
([post](https://openai.com/index/harness-engineering/)), and Anthropic's
agent-eval guidance
([post](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)).
The shared argument is not "harnesses no longer matter." It is that **two
different harnesses are being collapsed into one word**, and only one of them
is becoming a commodity.

Frontier models are already good at planning, searching repositories, using
tools, and recovering from mistakes. That makes the basic agent loop
(prompting, retries, tool routing, file editing) less differentiated and
increasingly built into products and SDKs. OpenAI is packaging a model-native
harness with file tools and sandbox execution. Anthropic treats an evaluated
"agent" as the **combination of the model and its harness**, not the model
alone. Those are signals that the generic loop is becoming infrastructure.

What remains strategically important is the **trust harness**: independent
evidence that a generated change is safe to merge.

## The thesis in one line

> Models generate the change. Otito proves whether the change is safe to merge.
> The generic model harness is becoming a commodity. The independent trust and
> governance harness is becoming more important.

otito **owns the second category** and integrates with Codex, Claude Code,
Gemini, Cursor, and future native harnesses rather than competing with them.

## What lines up: otito is already the trust harness

| Source claim | otito's existing answer |
| --- | --- |
| Native SDKs absorb prompting, retries, file tools, and sandbox execution | otito does not ship an agent loop. Hosts call `context_pack`, `review_gate`, and `convergence_score` as procedures. |
| Constraints, repository knowledge, tools, tests, and feedback loops are prerequisites for scaling | Context packs, risk paths, validation plans, receipts, and the operating loop are the shipped form of those prerequisites. |
| An evaluated "agent" is model plus harness | Otito is the **independent** half of that pair: deterministic facts a host cannot grade for itself. |
| Stronger models increase unsupervised change volume | Merge gates, CODEOWNERS, branch-protection checks, and human decision remain separate authorities. |
| Graders should verify outcomes in the environment, not the transcript | `review_gate` and validation attestation run against the **exact staged tree**, not the chat. |
| Code-based graders are objective, reproducible, and easy to debug | Gates, convergence receipts, and policy profiles are recomputable from repo state. |

The useful observation: the original harness thesis is still true as a **cost
property** (a tighter repo lets a cheaper model do more). It is no longer the
**lead claim**. Token savings narrow as models get better. Independent merge
evidence does not.

## Four layers, mapped to otito

| Layer | Trajectory | Otito's job |
| --- | --- | --- |
| Context generation | Still useful, easier for model vendors to absorb | Keep shipping `context_pack` and code maps as grounding, not as the product identity |
| Generic orchestration | Rapidly commoditising | Do not compete with native loops, sandboxes, or file tools |
| Deterministic merge evidence | Durable, valuable core | Own `review_gate`, validation receipts, convergence, CODEOWNERS, and policy |
| Organisation-level governance | Strongest commercial opportunity | Bind those receipts to owners, required checks, and a human merge decision |

The workflow already encodes this split:

```text
Request -> context -> scoped change -> exact validation -> review evidence -> human decision
```

Context is still in the loop. It is no longer the claim that differentiates
otito from a native harness.

## Six lessons, mapped to otito

### 1. Split the word "harness" (positioning)

[The harness thesis](../07-harness-thesis/README.md) taught "you control the
harness, not the model." This doc teaches **which harness**. The generic loop
is what vendors will ship. The trust harness is what organisations still have
to own: current repository context, permission boundaries, exact validation,
risk-sensitive policy, CODEOWNERS, receipts, and independent evidence.

Lead with that split. Do not lead with "a better harness makes the model
smarter or cheaper."

### 2. Integrate with native harnesses instead of replacing them

Codex, Claude Code, Gemini, Cursor, and future model-native scaffolds will
keep getting better at editing files. otito's MCP and CLI skills already sit
beside those hosts. The product bet is **complementarity**: they generate; otito
attests.

### 3. Keep verification outside the model loop

OpenAI's own experiment found constraints, repository knowledge, tools, tests,
and feedback loops were prerequisites for scaling, not optional extras.
Anthropic's eval guidance is the same idea from the measurement side: grade
the **outcome in the environment**, not the model's self-description.

otito already refuses to let a model award itself a merge. `review_gate`,
`review_verdict`, and `convergence_score` recompute from git facts.

### 4. Treat stronger models as more governance demand, not less

A weaker model needed a tighter loop to look competent. A stronger model needs
a tighter **trust** loop because teams will let it run longer, touch more
files, and ask for less supervision. AX scoring still measures cheap-and-safe
changeability. Governance demand scales with capability, not against it.

### 5. Make organisation-level policy the commercial edge

Local merge evidence is the durable core. The strongest commercial surface is
what sits on top of it: CODEOWNERS, required checks, risk profiles, workspace
receipts, and a human decision record that survives chat memory. That is
governance a vendor harness cannot honestly provide for a customer's repo
without becoming the customer's control plane.

### 6. Hold the line against competing with infrastructure (what this is NOT)

otito is not:

- a better agent loop than Codex or Claude Code
- a sandbox or file-tool runtime
- a claim that context packs will stay uniquely hard
- a promise that cheaper models remain the main buyer reason

The differentiated bet: **be the independent proof layer beside whoever
generates the patch.**

## How the thesis docs fit together

```text
Trust harness (this doc)        ->  which harness is durable, and who to integrate with
Dual-mode (docs/12)             ->  two modes, complementary roles
Prompt determinism (docs/13)    ->  you cannot collapse modes via prompting
Determinism (docs/11)           ->  why the probabilistic mode cannot self-verify
Harness (docs/07)               ->  what you still control; AX as a cost property
Convergence (docs/09)           ->  how you measure intent vs. execution deterministically
Clean code (docs/16)            ->  craft as owner files, focused diffs, and gates
```

Read this doc first when the question is "do harnesses still matter?" Read
dual-mode next for the generation/verification split. Read harness and
convergence when designing AX scores and gates.

## Priorities

| Priority | Work | Why first | Effort |
| --- | --- | --- | --- |
| **P0** | Trust-harness positioning (lessons 1, 2, 6) | Stops otito competing with vendor loops in its own README | Low: this doc plus README |
| **P0** | Keep merge evidence load-bearing in CI | Makes "prove the change" the default path, not a docs claim | Medium: ties to docs/09 |
| **P1** | Host integration snippets for native harnesses | Codex, Claude Code, Gemini, Cursor, Zed should all call the same procedures | Low |
| **P1** | Organisation-level governance packet | CODEOWNERS, required checks, policy profiles, and decision records as the commercial surface | Medium |
| **P2** | Context as grounding, not identity | Keep `context_pack` excellent without leading the product story with it | Low |

## What this is NOT

Not a claim that agent loops are worthless. Not a claim that context generation
is finished. Not a replacement for Codex, Claude Code, Gemini, or Cursor. The
differentiated bet is **independence**: models generate the change; otito
proves whether it is safe to merge.

## Sources

- OpenAI, _The next evolution of the Agents SDK_:
  <https://openai.com/index/the-next-evolution-of-the-agents-sdk/>
- OpenAI, _Harness engineering_:
  <https://openai.com/index/harness-engineering/>
- Anthropic, _Demystifying evals for AI agents_:
  <https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents>
- otito source referenced above: `src/lib/pass-local.js`, `src/lib/review.js`,
  `src/lib/converge.js`, `src/lib/policy.js`, `src/lib/codeowners.js`,
  `src/lib/context-engine.js`, `codex/skills/otito-review/`
- Companions: [Harness Thesis](../07-harness-thesis/README.md),
  [Dual-Mode Thesis](../12-dual-mode-thesis/README.md),
  [Determinism Thesis](../11-determinism-thesis/README.md),
  [Convergence Thesis](../09-convergence-thesis/README.md),
  [Prompt Determinism Thesis](../13-prompt-determinism-thesis/README.md),
  [Clean Code Thesis](../16-clean-code-thesis/README.md)
