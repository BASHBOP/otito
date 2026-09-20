# Model Routing & the Question That Carries Information

> _Why otito can ask a model for a probability without becoming probabilistic._

This document maps a claim from the System One conversation onto otito's
existing surface, then turns it into a concrete, prioritised roadmap. It mirrors
[the calibration thesis](../17-calibration-thesis/README.md),
[the determinism thesis](../11-determinism-thesis/README.md), and
[the dual-mode thesis](../12-dual-mode-thesis/README.md): take a source, name
what otito has quietly already built, and let the naming sharpen the product.

The source is the same one the calibration thesis used, TypeSafe's System One
launch ([announcement](https://typesafe.ai/blog/introducing-system-one-models-and-jev),
[concepts](https://docs.typesafe.ai/concepts/system-one)). There, the question
was whether otito's own risk score is calibrated. Here it is the reverse
direction: **can otito spend a calibrated model where it has no signal of its
own, without giving up what makes otito trustworthy?**

The answer is yes, and the reason is a boundary, not a compromise.

## The boundary, this does not weaken the gate

otito's three standing promises are that the gate is a pure function of
repository state, that it needs no network, key or vendor, and that every number
it reports can be traced to a measurement. A vendor model call inside the gate
would break all three at once.

The router is not in the gate.

| | Router | Gate |
| --- | --- | --- |
| Runs | **before** work starts | **after** the diff exists |
| Decides | how much model to spend | whether the change may merge |
| Depends on | a network call that may fail | repository state only |
| Worst failure | wrong model tier, money wasted | never reached by this path |

Nothing the router says can make a change pass. If Jev is down, unreachable or
unkeyed, the router falls back to a local estimate and says so in
`jev.source`; the gate does not notice, because the gate never asks. The code
enforces the separation physically: the router lives in `scripts/`, imports
otito's libraries read-only, and writes nothing any gate reads.

So it does not violate otito. It extends it, in the direction the calibration
thesis already pointed: otito's signals get a second consumer, and the router's
tier becomes one more number that has to be graded against outcomes rather than
asserted. What follows is largely the record of that grading going badly at
first, which is the point.

## How we use Jev

Jev is a System One model: it takes a **state**, takes **typed questions**, and
returns typed answers with calibrated probabilities. It does not write prose and
we never ask it to. One call, `POST https://api.typesafe.ai/v1/systemone`,
answers every question in parallel against one state.

### The state is otito's output

The first thing we send is not the prompt. It is the prompt **plus otito's
resolution of it**, the files otito believes the request touches, and why:

```json
{
  "request": "migrate the session cookie format in the auth middleware",
  "repository": { "name": "bashbop-event-application", "agent_experience": 62, "containment": 16 },
  "likely_files": [
    { "path": "redux/slices/auth-slice.ts", "kind": "state",
      "why": ["path matches: auth", "symbol matches: session"] }
  ],
  "risk_flags": ["auth/security"]
}
```

This is the join that makes the pairing worth anything. Jev has never seen the
repository; otito has never read the request as language. Each supplies what the
other cannot.

### Three questions, and why each one

| Question | Type | What it reads |
| --- | --- | --- |
| `specificity` | Score, 3 levels | How precisely the request names what must change |
| `blast_radius` | Score, 3 levels | How far the implied edits reach |
| `novelty` | Noul | Whether this needs new design or an existing pattern |

They are deliberately atomic. We never ask "which model should I use?", that is
a judgement with no ground truth to calibrate against, and it would hand control
flow to the model. We ask narrow questions, take the probabilities, and combine
them in code we can read. That is the [composite scoring](https://docs.typesafe.ai/patterns/composite-scoring)
pattern, and it is the same division of labour otito already draws between
evidence and verdict.

Score `criteria` is an **ordered list**, not an object, index 0 is level 0.
Noul answers carry no `confidence`, only Score and Choice do, so the router's
confidence floor reads the weaker of the two Score answers.

### The arithmetic

Deterministic, in code, every term visible:

```
penalty = 0.25 x (specificity / 2)      each term takes a SHARE of AX,
        + 0.20 x (blast_radius / 2)     never a flat number of points,
        + 0.15 x P(novelty)             so the result stays on the AX scale
bonus   = 0.10 when containment >= 40
route   = clamp(AX x (1 - penalty + bonus), 0, 100)
tier    = route >= 75 cheap | >= 45 mid | < 45 premium
```

Then two fail-safe bumps, each moving **one tier toward the more capable model
and never the other way**: a top-severity risk flag (anything otito already
weights 3 in `RISK_SCORE_WEIGHTS`), and confidence below 0.55. A router that can
round *down* on a bad read is a router that ships bad changes cheaply.

### Cost and latency

Jev bills input only, at $0.042/Mtok. Measured on this corpus: **728 to 845 input
tokens, $0.000019 to $0.000034 per decision, 534 to 764 ms.** The money is a rounding
error against one premium turn. Latency is the budget that binds, and otito's
own half costs more than Jev's, about 5s, because `generateAxScore` recomputes
the impact pass the router already ran. A real `otito route` should compute
impact once.

## Running it, any host, one contract

```bash
otito route <repo> "<request>" [--json|--tier-only|--host <id>] [--offline] [--out file]
```

The router decides a **tier**. Each host turns that tier into whatever it calls
a model, so nothing about the scoring is specific to one editor:

```bash
otito route . "$PROMPT" --tier-only          # -> premium
otito route . "$PROMPT" --host claude-code   # -> claude-opus-5
claude --model "$(otito route . "$PROMPT" --host claude-code)" -p "$PROMPT"
```

Only `claude-code` ships filled in, because those are the ids this repository
can verify. Add your own in `.otito/model-route.json` (repo) or
`~/.otito/model-route.json` (user):

```json
{ "hosts": { "cursor": { "cheap": "...", "mid": "...", "premium": "..." } } }
```

Hosts with no map still work through `--tier-only`. Terminal output uses otito's
own renderer, so `--color`, `--no-color`, `--theme`, `NO_COLOR` and a piped
stdout behave exactly as they do everywhere else in the CLI.

Set `TYPESAFE_API_KEY` in your shell to use the model. Without it, or with
`--offline`, the run falls back to a local heuristic and labels every surface
`offline estimate, not calibrated`.

### The advisory footer

`otito ax` and `otito impact` already compute everything the repository half
needs, so both print one routing line under their normal output:

```
model route: premium (score 36) - offline estimate, advisory
```

That line is **offline by construction**. An ordinary otito command does not
make a network call, and a failure inside the router is swallowed rather than
allowed to change the output of the command you actually ran. `--json`,
`--out` and `--mermaid` are untouched, so nothing that parses otito's output
sees it; `--no-route` turns it off.

Reach for `otito route` when you want the model's read and the full arithmetic.

## Dogfood, bashbop-event-web, 2026-09-19

Five requests drawn from the repository's own recent work, run against
`bashbop-event-application` v23.15.0 with Jev 1.13.0.

| Request | AX | spec | blast | novelty | conf | route | band | tier |
| --- | --: | --: | --: | --: | --: | --: | --- | --- |
| fix the typo in the publish confirmation copy | 59 | 1.21 | 0.04 | 0.06 | 0.66 | 49 | mid | **mid** |
| show organisers what happens after they publish | 74 | 1.27 | 1.61 | 0.35 | 0.41 | 54 | mid | premium |
| add a `--json` flag to the seating export | 57 | 0.55 | 1.39 | 0.36 | 0.09 | 42 | premium | premium |
| the booking fee is wrong for free events | 57 | 1.76 | 1.60 | 0.14 | 0.41 | 34 | premium | premium |
| migrate the session cookie format in the auth middleware | 62 | 0.97 | 1.68 | 0.41 | 0.53 | 40 | premium | premium |

Run twice against the same corpus, Jev's answers moved by up to 0.05 and
confidence by up to 0.06. **No tier changed between the two runs.** The router is
not deterministic and is not claimed to be; it only has to be stable enough that
the same request does not oscillate between tiers, and across two runs it was.
Determinism is the gate's property, not the router's.

The first run of this corpus put **all five** at premium, which is the same as
having no router at all. Four defects came out of it, every one found by running
the thing rather than reasoning about it:

**1. A saturated question carries no information.** `specificity` began life as a
Noul, *"is this ambiguous enough that a wrong reading produces the wrong
change?"* Jev answered 0.57 to 0.81 for all five prompts, including the typo fix.
That is the correct answer: for any one-line request, yes. The question could
not separate the corpus, so its probabilities were noise however well
calibrated. Re-specified as a Score over levels you can point at in the text -
names the target / names an area / names a symptom, it discriminates: 0.59 for
the `--json` flag, 1.76 for the bug hunt. **Measure a question's variance before
trusting its weight.**

**2. State quality decides the answer.** The first run sent the prompt and four
numbers. Grounding the state in otito's ranked file evidence changed every
answer. Jev cannot tell whether "the publish confirmation copy" is specific
without seeing what the phrase resolves to.

**3. Reusing a signal double-counts it.** The offline estimator derived
`blast_radius` from `containment`, which is already inside AX at weight 0.30.
In a low-containment repository (bashbop-event-web sits at 11 to 26 throughout)
every prompt was penalised twice and pinned at blast 1.86. Keeping the model on
the request side and otito on the repository side is not a style preference; it
is what stops the double count.

**4. AX's bands do not belong to a non-AX quantity.** The 45/75 thresholds were
inherited from the model-router skill, where they band **AX itself**. The route
score was AX minus up to 52 flat points, a different quantity on a different
scale, so applying AX's bands to it was a category error. That is what pinned
the whole corpus below 45. The fix is not a nicer set of numbers: each term now
takes a **share of AX** rather than a flat count of points, so the route score
means "AX, after what this request costs" and stays on the scale its bands were
drawn for. Same Jev answers, rescored: 34 to 53, and the typo fix separates from
the bug hunt.

No request in this corpus reaches `cheap`. That is a true statement about
bashbop-event-web rather than a routing failure: with no CODEOWNERS file and
containment between 11 and 26, its AX tops out at 74, and `cheap` starts at 75.
The router cannot recommend a cheap model for a repository whose own shape says
changes there are not cheap.

A fifth issue, fixed in passing: classifying only the owner and supporting
buckets meant `redux/slices/auth-slice.ts`, ranked **first** for the auth
prompt, sat in the advisory bucket and the `auth/security` bump never fired.
Classifying everything instead made an unrelated billing component turn a copy
change into a money-flow change. The router now classifies owners, supporting
files, and the top three ranked predictions whatever bucket they landed in: rank
is evidence, the bucket is a label.

## What is not true yet

The weights and the bands were chosen by judgement and have never been compared
to an outcome. That is exactly the sentence [the calibration thesis](../17-calibration-thesis/README.md)
writes about `inferRisk`, and it applies here with no discount:

> A risk level that has never been compared to an outcome is a heuristic wearing
> a number.

So the router ships **advisory**: it prints a decision and a recommended tier,
and it does not pick a model for you. Promoting it past advisory needs the same
treatment `otito calibrate` gives the gate, replay the repository's history,
recompute the tier from the state as it was, and join to outcomes. The metric is
not accuracy. It is **regret**: changes routed cheap that ended in a revert or a
repair, weighed against the spend avoided. A router with zero regret and zero
savings is the table above.

## Roadmap

| Priority | Work | Why |
| :-: | --- | --- |
| 1 | Backtest tier against `reverted` and `repaired`, reusing the calibrate harness | Moves the router off judgement. The share weights are still ungraded |
| 2 | Mid-session re-score once the real file set is known | Prompt-only routing misreads "fix this typo" that turns out to touch auth |
| 3 | Widen the corpus beyond one repository | Five prompts in one app is an anecdote |

## References

- TypeSafe AI, _System One_: <https://docs.typesafe.ai/concepts/system-one>
- TypeSafe AI, _Composite scoring_: <https://docs.typesafe.ai/patterns/composite-scoring>
- TypeSafe AI, _Confidence_: <https://docs.typesafe.ai/confidence>
- otito, [Calibration Thesis](../17-calibration-thesis/README.md)
- otito, [Determinism Thesis](../11-determinism-thesis/README.md)
- Implementation: `src/lib/model-route.js` and `src/lib/render/route.js`, reachable as `otito route`
- `scripts/model-route.mjs` is a thin wrapper kept for the 1.12.0 prototype invocation
- Host-agnostic skill: `codex/skills/model-router/`
