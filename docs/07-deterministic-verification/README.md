# Deterministic Verification

> Why merge evidence is computed from the repository, never from the model that wrote the change.

A coding agent produces a diff. Something has to decide whether that diff is safe to merge. The question this document answers is what that something should be, and why asking the model is the wrong answer however good the model becomes.

## The problem

Language models are non-deterministic by construction. Temperature, floating-point arithmetic, distributed inference and changing external data all inject variance, so the same prompt can produce different output on two consecutive runs. This is a property of how the systems are built, not a defect awaiting a patch.

Three consequences follow, and each one rules out a tempting shortcut.

**Re-running the model is not a test.** If the output varies, a second run that looks acceptable tells you nothing about the first. Two runs agreeing is weak evidence; two runs disagreeing is not even a clear failure.

**Prompt settings do not make a gate.** Greedy decoding, a fixed seed and "always pick the highest probability" reduce variance in generation. They do not make the model an auditor of its own work, because the thing being verified and the thing verifying it remain the same system with the same blind spots. A model that misread a requirement will misread it consistently at temperature zero.

**A model cannot be the judge of its own output.** Verification has to be computed by something that did not write the change and cannot be talked out of its conclusion.

## The shape of an answer

Split the work by what each half is good at.

| | Generation | Verification |
| --- | --- | --- |
| Best served by | a probabilistic model | a deterministic function |
| Varies between runs | yes, usefully | never |
| Reads | intent, ambiguity, natural language | repository state |
| Fails by | producing a different answer | producing the same wrong answer every time, visibly |

Both halves are necessary. Ambiguous requirements, natural language and unfamiliar code are exactly where a probabilistic model earns its cost. Deciding whether a diff touches authentication, whether its owners reviewed it, and whether its tests ran are questions with one correct answer that does not depend on who asks.

otito is the second column. It recomputes the same evidence from the same repository state: which files a change touches, how far it reaches, who owns them, what validation exists, and whether the diff matches what was asked for. Every number traces to a measurement, the analysis runs locally with no network or vendor, and the same inputs always produce the same output.

## Why stronger models make this more valuable, not less

The intuition runs the other way: if models keep improving, a verification layer looks like scaffolding to be removed later.

Capability and accountability are different axes. A more capable model writes larger and more consequential changes, which raises the cost of an unreviewed mistake rather than lowering it. It does not acquire the ability to prove its own work, because that limit is structural rather than a matter of skill. And the organisational requirement is unchanged by either: a person still has to be able to say why a change was allowed to merge, in terms that survive the model being replaced next quarter.

A harness that depends on no particular model outlives every model it is used with. Agent orchestration is converging quickly across vendors; independent merge evidence is not, and it is the part a team cannot buy twice.

## What otito computes

**Context before the edit.** `context_pack` and the code map rank what a request actually touches from repository facts: paths, symbols, exports, imports and tests. This is retrieval grounded in the repository rather than in a model's memory of it.

**Impact and reach.** `change_impact` predicts the files a change should touch and validates that prediction against the diff that appeared. `agent_experience` scores how expensive and risky a change is in a given repository, so a codebase can be measured and improved rather than merely complained about. The method is in the [AX score spec](./ax-score-spec.md).

**Intent against execution.** `convergence_score` measures the gap between what was asked and what was actually done, and stamps the measurement with a receipt that recomputes to the same value from the same inputs. This is the check a model structurally cannot run on itself: it requires an independent statement of intent to compare against. The method is in the [convergence score spec](./convergence-score-spec.md).

**The gate.** `review_gate` and `review_verdict` return PASS, WARN or FAIL from repository state alone: changed paths and their risk classification, ownership, validation command availability, secret heuristics and policy profile. No model is consulted. The verdict names the policy profile and governance it ran under, which come from the caller or else from the repository's `.otitorc.json` and the user config, and anyone with the same checkout and those two settings reproduces it.

## Clean code, expressed as procedure

The same reasoning changes what "clean code" means when agents write most of it. Readability advice aimed at humans does not transfer directly to a reader that holds the whole file in context and never gets bored.

What does transfer is structural, and all of it is measurable: a change should touch few files rather than many, those files should have clear owners, the diff should stay close to what was asked, and the tests that cover it should exist and run. These are properties of a repository and a change, not habits of a programmer, which is why they can be gated rather than encouraged.

## What this is not

This is not an argument that models are unreliable or that agents should be distrusted. Generation is the half where a model is genuinely better than a deterministic system, and otito does not compete with it.

It is not a claim that deterministic checks catch everything. They catch what repository state can express: reach, ownership, risk classification, drift from intent, missing validation. Whether an implementation is correct is not among them.

It is not a proof of correctness. A PASS verdict means the specific checks passed and a human has what they need to decide, which is a smaller and more honest claim than "this change is safe".

## References

- Dev with Sordar (InfoWorld), _Why LLM Determinism Is So Hard_: <https://www.youtube.com/watch?v=lnVRR-SPRr4>
- _Probabilistic vs. Deterministic Models Explained in Under 2 Minutes_: <https://www.youtube.com/watch?v=U8kuVAvam50>
- Conversation on prompt-level determinism: <https://www.youtube.com/shorts/YRf_-mNEnvQ>
- Matt Pocock and David Ondrej, _Agentic Engineering Workflow_: <https://www.youtube.com/watch?v=nQwJVHCtDDY>
- ThetaDriven, _Mathematically Proving Software Sanity: Beyond AI and LLMs_: <https://www.youtube.com/watch?v=_Ioh8tGAnJI>, and the ThetaDriven blog on drift and receipts: <https://thetadriven.com/blog>
- OpenAI, _Harness engineering_: <https://openai.com/index/harness-engineering/>
- OpenAI, _The next evolution of the Agents SDK_: <https://openai.com/index/the-next-evolution-of-the-agents-sdk/>
- Anthropic, _Demystifying evals for AI agents_: <https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents>

Implementation: `src/lib/context-engine.js`, `src/lib/impact.js`, `src/lib/converge.js`, `src/lib/review.js`, `src/lib/pass-local.js`, `src/lib/risk-paths.js`, `src/lib/ax.js`.

Measurement: the [calibration thesis](../17-calibration-thesis/README.md) grades these signals against a repository's own history. [Model routing](../18-model-routing/README.md) covers spending a calibrated model on the request side without touching the gate.
