# Clean Code Thesis & the Smallest Owner File

> _Why clean code is a merge property, not an agent persona._

This document maps a widely taught craft rule onto otito's existing surface,
then turns it into a concrete, prioritised roadmap. It mirrors
[the dual-mode thesis](../12-dual-mode-thesis/README.md),
[the trust harness thesis](../14-trust-harness-thesis/README.md), and
[the convergence thesis](../09-convergence-thesis/README.md): take the source,
name what otito has quietly already built, and let the naming sharpen the product.

The source is the common craft of *clean code*: small units, one purpose, names
that reveal intent, tests as specification, and no speculative generality. Those
rules are older than coding agents. Agents make them more important, because a
model can generate a large, polite, unused layer as easily as it can change the
one file that already owns the behaviour.

The argument is not "teach the model Uncle Bob." It is **split the craft**:
deterministic cleanliness is already a gate; taste stays with the human and the
host. A cleaner agent, a refactor agent, or a Forge-style cleaner persona would
compete with the commodity loop. Otito should not.

## The thesis in one line

> Clean code is the change an owner can re-read, re-test, and recompute.
> Otito already enforces the deterministic half: smallest owner files, focused
> diffs, required validation, and scope evidence. Naming and abstraction stay
> with the human and the host.

otito **does not grade prose style**. It grades whether the change stayed in
the files that already own the work, whether validation ran against the exact
tree, and whether unrequested drift landed on risk-sensitive paths.

## What lines up: otito already encodes clean code as procedure

| Craft claim | otito's existing answer |
| --- | --- |
| Change the module that already owns the behaviour | `context_pack` and `change_impact` rank owner files before an agent edits |
| Prefer existing structure over a new layer | The agent prompt says to use selected patterns before adding new structure |
| One change, one purpose | Convergence scope scores unrequested drift against the stated task |
| Tests specify behaviour | Context packs list nearest tests; `review_gate` runs the validation plan |
| Leave the campground cleaner, not busier | The operating loop asks for the smallest complete change and no unrelated cleanup |
| Failures must be visible | `PASS` / `WARN` / `FAIL` plus exact staged-tree receipts |
| Style that can be checked belongs in the harness | `lint`, `format`, `typecheck`, and `npm run ci` are deterministic gates |
| Style that is taste belongs with a reviewer | Naming, extract-method judgment, and abstraction level stay human |

The useful observation: clean code is not a missing agent. It is the reason
Otito already tells hosts to start at the hotspot, read the owner file, and
verify with the repo's own commands.

## Two modes of cleanliness

[The dual-mode thesis](../12-dual-mode-thesis/README.md) already splits
generation from verification. Clean code has the same split:

| Mode | Clean-code work | Owner |
| --- | --- | --- |
| Deterministic | Format, lint, types, tests, focused scope, owner-file targeting | Otito, CI, `otito.gate.json` |
| Probabilistic | Names, extraction, API shape, comment voice | Host agent plus human review |

Asking a model to "write clean code" is a prompt. Asking a gate whether the
diff stayed in the owner files, passed `npm run ci`, and matched the stated
task is a fact. Otito owns the facts.

## Six lessons, mapped to otito

### 1. Treat clean code as evidence, not a persona (positioning)

Forge-style designs invent a Cleaner or Hardener agent that rewrites the tree
after the coder. That is another probabilistic loop grading itself. Otito's
answer is already shipped: context before the edit, validation on the exact
tree, convergence on intent versus diff, and a human merge decision.

Lead with **smallest owner file**. Do not lead with a style-guide chatbot.

### 2. Prefer the owner file over a new abstraction

A generated helper, wrapper, or `utils/` file is the usual dirty outcome of a
capable model. `change_impact` and the context-pack primary list exist so the
agent opens the file that already owns the change. If that file is the wrong
place, the human decides to move the boundary. The agent does not invent a
parallel structure by default.

### 3. Let lint, format, and tests be the style gate

Deterministic cleanliness is already in the quality gate: Prettier, ESLint,
typecheck, tests, coverage, evals, audit, and smoke. Those checks are
recomputable. They do not need an LLM to confirm that the tree is formatted or
that the nearest test still passes.

### 4. Use convergence to catch helpful cleanup

Unrelated renaming, drive-by refactors, and "while I was here" edits are the
agent form of broken windows. `convergence_score` already measures Coverage,
Scope, and Risk alignment. Scope is the clean-code check: did only the
requested work happen?

### 5. Keep AX as the cost of dirty structure

[The harness thesis](../07-harness-thesis/README.md) still holds as a cost
property. A wide, poorly owned, under-tested module is expensive for an agent
to change safely. AX scores that cost. Clean ownership raises AX. A new
abstraction that duplicates an existing owner lowers it.

### 6. Hold the line against a cleaner agent (what this is NOT)

otito is not:

- a refactor robot
- a complexity-metric merge blocker unless a repository asks for one
- a replacement for ESLint, Prettier, or the repo's own tests
- a claim that every Clean Code heuristic can be scored

The differentiated bet: **make the smallest correct change in the files that
already own it, then prove that change.**

## How the thesis docs fit together

```text
Clean code (this doc)           ->  craft as owner files, focused diffs, and gates
Trust harness (docs/14)         ->  which harness is durable; integrate with native loops
Dual-mode (docs/12)             ->  two modes, complementary roles
Convergence (docs/09)           ->  how you measure intent vs. execution
Harness (docs/07)               ->  AX as the cost of dirty or wide structure
```

Read this doc when the question is "should we add a cleaner agent, a style
persona, or a clean-code policy?" Read dual-mode for the generation and
verification split. Read convergence when the diff includes unrequested
cleanup.

## Priorities

| Priority | Work | Why first | Effort |
| --- | --- | --- | --- |
| **P0** | Clean-code positioning in contributor and agent docs | Stops a cleaner-agent fork of Otito and states the owner-file rule | Low: this doc plus CONTRIBUTING and AGENTS |
| **P0** | Agent prompt names the smallest owner file | Every `context_pack` already steers hosts; make the craft rule explicit | Low |
| **P1** | Keep lint, format, and tests load-bearing | Deterministic cleanliness stays in CI, not in a prompt | Already shipped |
| **P2** | Optional repo-local complexity policy | Only if a consuming repo asks; do not invent a global metric gate | Medium |

## What this is NOT

Not a productisation of any one book. Not a promise that Otito can score
"good names." Not a replacement for maintainer taste. The differentiated bet
is **procedure**: ground the agent in the owner files, keep the diff on
purpose, and let deterministic checks plus a human decide.

## Sources

- The common clean-code craft (small units, one purpose, reveal intent, test
  the behaviour, avoid speculative generality). Robert C. Martin, *Clean
  Code* (2008), is the widely cited statement of those rules. This page
  restates the craft in Otito's terms and does not reproduce the book.
- otito source referenced above: `src/lib/context-engine.js`,
  `src/lib/impact.js`, `src/lib/converge.js`, `src/lib/pass-local.js`,
  `src/lib/ax.js`, `AGENTS.md`, `CONTRIBUTING.md`
- Companions: [Trust Harness Thesis](../14-trust-harness-thesis/README.md),
  [Dual-Mode Thesis](../12-dual-mode-thesis/README.md),
  [Convergence Thesis](../09-convergence-thesis/README.md),
  [Harness Thesis](../07-harness-thesis/README.md)
