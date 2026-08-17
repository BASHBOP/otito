# Prompt Determinism Thesis & the Settings Trap

> _Why "just tell it to pick the highest probability" is not a merge gate — and what otito ships instead._

This document maps a widely-shared conversation about prompt-level determinism onto
otito's existing surface, then turns it into a concrete, prioritised roadmap. It mirrors
[the dual-mode thesis](../12-dual-mode-thesis/README.md),
[the determinism thesis](../11-determinism-thesis/README.md),
[the harness thesis](../07-harness-thesis/README.md), and
[the convergence thesis](../09-convergence-thesis/README.md): take a video, name what
otito has quietly already built, and let the naming sharpen the product.

The source is a short-form conversation on prompting LLMs toward repeatable outputs
([video](https://www.youtube.com/shorts/YRf_-mNEnvQ)). The speakers wonder aloud whether
you can make a chat **deterministic** by instructing it to always take the closest match
in vector space, or to **never randomize** and always choose the highest-probability
token. The proposed experiment: set those conditions in the prompt, run the same input
twice, and see if the response matches.

That experiment is useful — and it usually fails for the reasons in
[the determinism thesis](../11-determinism-thesis/README.md). The short's closing beat
names the deeper issue: models are also trying to mimic human thought, which is **not
always the obvious next token**. Variability is not always a bug you can prompt away.

This doc maps the **folk fix** (prompt your way to determinism) to otito's **structural
fix** (verify outside the model).

## The thesis in one line

> Prompt settings can nudge sampling behavior; they **do not** turn a probabilistic
> generator into a deterministic verifier. If your trust strategy is "tell it not to
> randomize," you are still testing the chat — not the change.

otito **tests the change**: git diff, gate checks, and convergence receipts on repo facts.

## What lines up — otito is already the answer

| Short's idea | otito's existing answer |
| --- | --- |
| "Always take the closest thing in vector space" | Retrieval grounding is otito's job via `context_pack` and code maps — **indexed repo facts**, not prompt wishes about embedding space. |
| "Don't randomize — go with highest probability" | Greedy decoding is a **generation setting**, not merge evidence. otito never uses token choice as a gate input. |
| "Set the conditions in the prompt" | Task queries feed **impact prediction** and convergence — they do not replace deterministic checks. |
| "Test it and see if you get the same response" | The right test is **same repo + same task → same gate verdict and convergence receipt**, not same chat transcript. |
| "Human thought is not always the obvious" | Agents should stay probabilistic for judgment. **Obvious merge rules** (owners, risk paths, validation) stay deterministic in `review_gate`. |

The useful observation: the short describes a experiment every team runs once. otito
operationalizes what you do **after** that experiment fails — move verification to an
out-of-band layer that does not depend on sampling settings.

## Six lessons, mapped to otito

### 1. Name the trap (positioning)

The dual-mode doc says use both modes. The determinism doc says LLM variance is
structural. This doc names the **trap between them**: **mode collapse via prompting** —
trying to make the probabilistic layer behave deterministically because the prompt says so.

otito's positioning line: *prompts steer generation; gates verify changes.* That is a
clean answer to "can't I just tell it not to randomize?"

### 2. Prompt conditions are not rules

The short treats prompt instructions as **conditions of how the chat works**. In software
delivery, conditions that matter for trust must be **executable and auditable**:

- Did the diff touch `src/lib/pass-local.js`?
- Was convergence above the floor?
- Did required validation commands exist?

Those are otito rules. A system prompt that says "pick the highest probability" is not
recomputable evidence and cannot be attached to a PR as a receipt.

### 3. Greedy decoding is not a harness

Temperature zero and top-token selection reduce variance in **generation**. They do not:

- prove the right files were edited
- detect scope drift
- classify risk-sensitive paths
- bind a human merge decision to git facts

When the short's speaker says "I'm going to test that today," the otito workflow says:
**test the diff with `otito converge` and `otito gate`**, not the chat twice.

### 4. Ground retrieval in indexes, not prompt metaphors

"Closest in vector space" is a retrieval metaphor. otito already ships deterministic
retrieval over repository structure:

- `repo_index` / local catalog
- AST-backed code maps (`generateCodeMap`)
- task-aware ranking in `context-engine.js`

Same task + same indexed repo state → same primary files in the context pack. That is
the engineering version of "closest match," without asking the model to honor a prompt
about embeddings.

### 5. Keep human-like variability in generation, not in gates

The short ends by noting models mimic **non-obvious human thought**. That is a feature
for drafting and explanation. It is a defect for **merge approval**.

otito's split preserves both:

- **Probabilistic:** agent interprets the ticket and writes the patch
- **Deterministic:** gate asks whether the patch matches the ask and passes policy

Trying to prompt away variability in generation fights the model. Moving variability
**out of the gate** works with the model.

### 6. Hold the line against prompt-as-gate (what this is NOT)

otito is not:

- a collection of magic prompts that make agents deterministic
- a replacement for temperature/seed tuning in your host
- an argument that prompt engineering is useless (it scopes work)
- a claim that two chat runs will never match

The differentiated bet: **even when two chat runs match, you still need deterministic
merge evidence** — because the chat is not the artifact that ships.

## How the thesis docs fit together

```text
Trust harness (docs/14)       ->  which harness is durable; integrate with native loops
Dual-mode (docs/12)           ->  two modes, complementary roles
Prompt determinism (this doc) ->  you cannot collapse modes via prompting
Determinism (docs/11)         ->  why generation settings still fail at scale
Harness (docs/07)             ->  what you still control; AX as a cost property
Convergence (docs/09)         ->  how you measure intent vs. execution deterministically
```

Read dual-mode first, then this doc when someone proposes "just tell it not to
randomize." Read determinism next for the full engineering stack (float math, distributed
inference, external data).

## Priorities

| Priority | Work | Why first | Effort |
| --- | --- | --- | --- |
| **P0** | Prompt-trap positioning (lessons 1, 6) | Low cost; answers the most common folk fix before teams waste a sprint on it | Low — this doc |
| **P0** | Convergence + gate as the post-prompt test (lesson 3) | Turns "run it twice" into "measure the diff" | Medium — ties to docs/09 |
| **P1** | Context pack as deterministic retrieval (lesson 4) | Gives teams the constructive alternative to "closest in vector space" prompts | Low — already shipped |
| **P1** | Host guidance doc snippet (lesson 2) | One paragraph for MCP docs: sampling settings ≠ merge trust | Low |
| **P2** | Eval case: same prompt, different diffs | Quantify how often greedy settings still produce divergent convergence scores | Medium |

## What this is NOT

Not anti-prompt-engineering. Not a claim that greedy decoding is worthless. Not a promise
that otito makes agents creative or consistent in chat. The differentiated bet: **prompts
scope probabilistic work; otito verifies deterministic facts about what actually changed.**

## Sources

- Conversation on prompt-level determinism (YouTube Shorts) —
  <https://www.youtube.com/shorts/YRf_-mNEnvQ>
- otito source referenced above: `src/lib/context-engine.js`, `src/lib/converge.js`,
  `src/lib/pass-local.js`, `src/lib/code-map/generate.js`, `src/lib/review.js`
- Companions: [Trust Harness Thesis](../14-trust-harness-thesis/README.md),
  [Dual-Mode Thesis](../12-dual-mode-thesis/README.md),
  [Determinism Thesis](../11-determinism-thesis/README.md),
  [Harness Thesis](../07-harness-thesis/README.md),
  [Convergence Thesis](../09-convergence-thesis/README.md)
