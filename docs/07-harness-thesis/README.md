# Harness Thesis & Agent Experience

> _Why otito still bets on a harness, which harness is durable, and the AX roadmap that follows._

This document maps a widely-shared argument about agentic engineering onto otito's
existing surface, then turns it into a concrete, prioritised roadmap. The source is a
conversation between David Ondrej and Matt Pocock on agentic engineering workflow
([video](https://www.youtube.com/watch?v=nQwJVHCtDDY)). The point of the exercise is not
to chase a trend — it is that otito has been quietly building the thing Pocock argues
matters most, and naming it sharpens the product.

## The thesis in one line

> Everyone obsesses over the model. You still control a harness, but the generic
> agent loop is becoming vendor infrastructure. Otito owns the **trust harness**:
> context, gates, receipts, and independent merge evidence. A tighter repo still
> lets a cheaper model do more; that is now the AX score, not the lead claim.

otito **is** that trust layer. It is deterministic, local-first, and model-agnostic.
The generic loop belongs to Codex, Claude Code, Gemini, Cursor, and future native
harnesses. See [the trust harness thesis](../14-trust-harness-thesis/README.md).

## Why stronger models make the harness more important

Model capability changes the amount of code an agent can produce; it does not turn model
output into independent evidence. As agents become faster and more autonomous, three
pressures rise together:

1. More generated change reaches review in less time.
2. A capable agent can make a larger coherent mistake before a human notices.
3. The model that created a change is still not an independent authority for tests,
   ownership, CI state, or merge approval.

The product implication is clear: do not compete with model labs on generation. Build the
stable trust layer around every model — scoped repository context before the edit,
deterministic validation and gate evidence after the edit, and a named human decision
before release.

## Eight lessons, mapped to otito

### 1. Own the word "harness" (positioning)

The video reframes "code context tool" as something bigger: the environment an agent runs
in. otito already generates harnesses (`otito harness`, `repo_harness`) and gates
(`otito gate`, `review_gate`). Keep that vocabulary, then split it. The generic loop
(prompts, retries, file tools) is becoming infrastructure. The **trust harness**
(context, validation, owners, receipts) is the durable product. The README now leads
with merge evidence, not cheaper models. See
[the trust harness thesis](../14-trust-harness-thesis/README.md).

### 2. "A cheaper model works if the codebase is easy to change" → make it measurable

Pocock's most concrete, quotable claim: better architecture means fewer tokens, which means
a dumber/cheaper model does the same work. otito already estimates context-token size
(`estimateTokenSections` in `src/lib/tokens.js`) and scores how much a change touches
(`generateImpact` in `src/lib/impact.js`). Combine them into an **Agent Experience (AX)
score** — a single number for "how expensive and risky is it for an agent to make a change
here?" — that drops as the harness improves. See
[ax-score-spec.md](./ax-score-spec.md). No competing tool ships this.

### 3. Strategic vs. tactical programming → context packs are delegation scaffolding

AI has eaten *tactical* programming (writing the code); the human edge is *strategic*
(scoping, interfaces, tests, just-enough docs to point the agent at the right place). That
is exactly what `otito context` (`context_pack`) produces: primary files, related files,
tests, patterns, and validation commands. Frame context packs explicitly as **delegation
scaffolding** — the artifact a strategic operator hands to a fleet of tactical agents.

### 4. Skills leak into context → audit otito's own tool surface

Every MCP tool description is permanent context cost for every agent that loads the server.
otito exposes ~12 tools. Audit the descriptions for bloat, keep the surface minimal, and
consider a `disable model invocation`-style flag so heavy tools (e.g. a full `repo_index`)
are user-invoked **procedures** rather than always-on **abilities**. This makes otito the
kind of lean tool that survives Pocock's "delete everything and start from a blank slate"
exercise rather than being deleted by it.

### 5. Procedures over abilities → ship otito as deliberate skills

Pocock prefers user-invoked *procedures* over model-invoked *abilities*, and distributes
them via `npx skills add`. otito could ship thin procedure skills — `otito-context`,
`otito-review`, `otito-scope` — that wrap the CLI as deliberate steps in Claude Code /
Codex. His "grill me before you implement" idea maps onto a scoping skill: feed a
`otito context` pack into an adversarial-interview step *before* the agent edits.

### 6. Queues, not loops → be the deterministic gate node

Pocock rejects the "agentic loop" hype in favour of **queues** of scoped tasks with
**human-in-the-loop checkpoints pushed as far toward production as is safe**, and asks the
decisive question: *"who reviews the AI that decides what doesn't need review?"* otito's
answer is structural: `review_gate` is **deterministic** — non-model gating is precisely how
you avoid an AI grading its own homework. Lean the `init` CI scaffolding (v2.1.0) into this
story: otito is the gate node in an AFK / GitHub Actions queue, and `review_verdict` can
emit a structured "auto-merge eligible / needs human" signal so teams move the checkpoint
rightward **with evidence**.

### 7. Build self-improving loops → scheduled, cheap-model review

"If someone keeps stealing your bike, buy a lock." Fix the system, not the bug. Pocock
suggests a daily cron that reviews a slice of the repo with a *cheap* model. otito's
"durable evidence" framing already gestures at this. Add a **scheduled review mode** that
walks one part of the repo per run, tracks recurring risk patterns over time (via the
existing `RISK_FLAGS` / `classifyPath` machinery in `src/lib/risk-paths.js`), and feeds them
back into the gate. That is otito as a self-improving harness, not a one-shot check.

### 8. Make review seamless → richer review artifacts

Pocock praises optimising for human review (narrated walkthroughs, rich HTML). This lines
up with the v2.2.0 work on Mermaid export and themed rendering (`formatReviewMermaid`,
`src/lib/render/fancy.js`). Push `pr` / `review` output toward a single rich artifact a
reviewer consumes in one glance — the gate verdict, blast radius, and required owners
together, one button-click away instead of a debugging session away.

## What this is NOT

The video is also a caution against hype, and otito should hold the same line. We are not
adding a model. We are not predicting which lab wins. We are not building an autonomous
merge bot. The differentiated bet is the opposite: **deterministic static analysis that a
model cannot do for itself**, framed as the durable half of the stack.

## Priorities

| Priority | Work | Why first | Effort |
| --- | --- | --- | --- |
| **P0** | Gate-effectiveness eval | Proves the gate allows a valid control and blocks known-bad changes for named deterministic reasons | Done — `otito eval --gate-effectiveness` |
| **P0** | AX / tokens-to-change score (lesson 2) | Defensible, measurable, unique; reuses `tokens.js` + `impact.js` + `review.js` | Medium — see [spec](./ax-score-spec.md) |
| **P0** | Independent trust-harness positioning (lessons 1, 6) | Keeps the product durable as model capability and vendor choices change | Active — README and docs aligned |
| **P1** | Tool-surface / context-leak audit (lesson 4) | Keeps otito lean enough to survive the "blank slate" test | Low–Medium |
| **P1** | Scheduled cheap-model review mode (lesson 7) | Turns the gate into a self-improving loop | Medium |
| **P2** | Procedure skills package (lesson 5) | Shipped under `codex/skills/otito-{context,review,scope}/` | Done |
| **P2** | Richer single-glance review artifact (lesson 8) | Builds on existing Mermaid/theme rendering | Medium |

## Sources

- Matt Pocock & David Ondrej, _Agentic Engineering Workflow_ — <https://www.youtube.com/watch?v=nQwJVHCtDDY>
- otito source referenced above: `src/lib/tokens.js`, `src/lib/impact.js`, `src/lib/review.js`, `src/lib/risk-paths.js`, `src/lib/harness.js`
- Companion: [Trust Harness Thesis](../14-trust-harness-thesis/README.md) (which harness is durable),
  [Determinism Thesis](../11-determinism-thesis/README.md) (why the harness must be non-model),
  [Dual-Mode Thesis](../12-dual-mode-thesis/README.md) (probabilistic generation + deterministic verification),
  [Prompt Determinism Thesis](../13-prompt-determinism-thesis/README.md) (prompt settings are not a gate),
  [Convergence Thesis](../09-convergence-thesis/README.md)
