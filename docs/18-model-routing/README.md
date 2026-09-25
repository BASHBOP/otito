# Model Routing

> Why otito can ask a model for a probability without becoming probabilistic.

Some questions about a coding task have no answer in repository state. How
precisely a request names what has to change, and how far the edits it implies
will reach, are properties of the sentence rather than of the code. otito has
never read a request as language, so it cannot answer them.

The question this document answers is whether otito can spend a calibrated
model on that half without giving up what makes it trustworthy.

The answer is yes, and the reason is a boundary rather than a compromise: the
model is asked **before** work starts, about how much model to spend, and
nothing it says can reach the gate that decides whether a change may merge.

The calibrated model used here is a System One model
([announcement](https://typesafe.ai/blog/introducing-system-one-models-and-jev),
[concepts](https://docs.typesafe.ai/concepts/system-one)), which takes typed
questions and returns probabilities trained against outcomes rather than prose
to be parsed. The reverse direction, grading otito's own signals against
history, is in the [calibration](../17-calibration-thesis/README.md) page.

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
Noul answers carry no `confidence`, only Score and Choice do, so the router
reports the weaker of the two Score confidences, for a reader. It is a display
threshold only, and not a routing input: a spread answer already pays through
its own score term, and reading confidence as a second input escalated 67% of
requests on this repository (see the otito dogfood below). The offline estimator
reports `null`: it has a shape, not a measurement.

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

Both bumps read evidence that has to be about shipped code. Tests and fixture
corpora still count toward reach, because they are real files the change touches, but
they never carry a risk flag. Routing otito itself is the case that shows why:
the repository has no checkout and no auth controller, so `add refund handling
to checkout` ranks `evals/fixtures/shop-api/.../checkout.service.ts` first and
used to escalate to premium on evidence from a corpus that ships nothing.

### What the call carries

Every call goes out under a `user-agent` of `otito/<version>`, so TypeSafe can
tell Otito's traffic from a hand-written client. The tag holds the client name
and version only: no user, no repository, no key. The body is the state
described above and the questions; file contents never leave the machine.

### Cost and latency

Jev bills input only, at $0.042/Mtok. Measured on this repository on 2026-09-26
against `jev-1.13.0`, with the request read folded into the same call: **2,059 to
2,165 input tokens, $0.000086 to $0.000091 per decision, 291 to 323 ms.** A
`context --online` read at the 24-file cap is 2,827 tokens, $0.000119 (below).
The pre-read figure this section used to print, 728 to 845 tokens, is 2.6× lower
than the call that ships today. The money is a rounding error against one
premium turn. Latency is the budget that binds, and otito's
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
`offline estimate, not calibrated`. That heuristic scores; it does not claim a
confidence, so the offline path reports `confidence: not measured` and the
low-confidence bump does not fire. Before that was true, `distribute(0.6)`,
the baseline for any request the keyword lists do not recognise, peaked at
0.40, and reading that shape as confidence escalated every unknown request one
tier: the offline router's default was "spend more".

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

### Over MCP

The `model_route` tool is the same contract for any MCP host (Cursor, VS Code,
Claude Desktop, Codex, Gemini): `{ query, path?, host?, offline? }` in, the
`otito route --json` payload out. It calls Jev only when `TYPESAFE_API_KEY` is
in the server's environment and `offline` is not true, and it declares
`openWorldHint: true` because it may. Host configs are in
[MCP and Agent Workflows](../02-mcp-agent-workflows/README.md#realtime-canvas-and-model-routing-opt-in).

## The request read: the same call, three more questions

The route questions ask how hard a request is. Three more questions ask what it
_is_, and they ride the same call, because System One evaluates each question
independently against one state (TypeSafe's
[speculative fan-out](https://docs.typesafe.ai/patterns/fan-out)): more
questions cost input tokens, not round trips or context.

| Question | Type | Gate before anything acts on it |
| --- | --- | --- |
| `read_intent` | Choice over `add`, `fix`, `change`, `refactor`, `test`, `debug`, `review`, `explain` | confidence ≥ 0.5 |
| `read_capability` | Choice over the MCP tool catalog, plus `none` | confidence ≥ 0.5 |
| `read_file_<n>` | Noul per ranked file: would the work need this file? | demote only under 0.2 |

The floors follow TypeSafe's [confidence guidance](https://docs.typesafe.ai/confidence):
do not act under 0.5, and scale the bar with the consequence. Relabelling an
intent is cheap to get wrong; dropping a file from an agent's context is not,
so a file leaves only on a strong no.

**In `otito route`** the read is reported under `model.read` and in its own
section of the output, and `scoreDecision` never sees it: a test holds that the
same route answers score identically with and without it. The Claude Code prompt
hook adds a line for any answer that cleared its floor.

**In `otito context --online`** (MCP: `context_pack { online: true }`) the read
is applied, and nowhere else. The same questions run over the pack's primary and
related files:

- an accepted intent replaces otito's action word and withdraws the
  "requested action is ambiguous" open question;
- a file under 0.2 leaves the ranked lists, and its hotspots with it, and is
  kept under `modelRead.demoted` with its score and original rank;
- the remaining files are re-ranked by relevance, each carrying its original
  `rank`;
- a read that rejects every primary file is not applied to them. It says the
  candidates are wrong, not that the agent should read nothing, which is the
  same reasoning as the router's `no evidence` floor.

A pack is still a pure function of repository state unless `online` is asked
for, and a failed or unkeyed call returns otito's pack unchanged with the
reason under `modelRead`. Measured on this repository against a question whose
offline pack ranked an RSVP eval fixture as related to MCP integration: intent
`unknown` → `add` at 0.60, the fixture demoted at 0.17, `src/lib/mcp.js`
re-ranked first; 2,827 input tokens, $0.000119, 361 ms.

None of this is graded yet. Like the tier, the read is a number that has to be
compared to outcomes before anything is promoted past advisory.

### Routing every request, without pretending to switch the model

A skill only routes when the model remembers to invoke it, which means the
request most worth routing — a quick one — is the one least likely to trigger
it. `scripts/hooks/route-prompt.mjs` is a Claude Code `UserPromptSubmit` hook
that closes that half of the gap: it scores the request and returns the tier as
context, before any work starts, every time.

It is careful about what it claims, because the honest ceiling is low:

| | possible? |
| --- | --- |
| Route every request deterministically | **yes**, this hook |
| Name the model a subagent should run on | **yes**, the Task/Agent tool takes a model |
| Change the model this session runs on | **no** |

The third row is not a missing feature. No hook output carries a model:
`PreModelSwitch` may block a switch and `PostModelSwitch` is read-only, and the
app refuses to let a session re-price its own turns. So the hook advises the
session and **binds the subagent**, and says so in as many words — claiming the
host switched models when it only recommended a tier is an anti-pattern the
skill names.

Wire it up per repository, in `.claude/settings.local.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [{ "type": "command", "command": "node \"/path/to/otito/scripts/hooks/route-prompt.mjs\"", "timeout": 10 }]
      }
    ]
  }
}
```

Three properties it has to have, and the reason for each:

**It never eats a prompt.** Every failure path — unparseable stdin, a missing
CLI, a crash, a repository it cannot score — exits 0 and writes nothing. A
router that can swallow a request is worse than no router.

**It has a deadline.** The routing call is killed at 6 seconds. A slow or huge
repository costs the hint, not the turn.

**It skips what is not work.** Turn-taking prompts (`ok`, `thanks`, `ship it`)
and slash commands route nothing, because spending seconds of latency to score
the word "ok" is a cost with no answer attached. The filter is deliberately
permissive in the other direction: a skipped request loses a hint, while a
spurious one loses seconds, so anything ambiguous routes.

**A subagent never routes.** It was launched on a tier its caller already chose,
so re-routing would second-guess that, and a subagent that routes could launch a
subagent.

Keying is the same as `otito route`: with `TYPESAFE_API_KEY` set it asks Jev,
and without one it falls back to the offline estimate, which is weaker but free
and needs no network.

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

## Dogfood, otito, 2026-09-20

The corpus above was measured against `bashbop-event-web`, whose AX tops out at
74. Run against **this** repository, the same router escalated 67% of requests
and put six of nine on the premium tier.

| request | route | confidence | before | after |
| --- | --- | --- | --- | --- |
| fix a typo in the README | 54 | 0.79 | mid | mid |
| sort the imports in `src/lib/ax.js` | 61 | 0.77 | mid | mid |
| rename the variable `running` to `score` | 68 | 0.54 | **premium** | mid |
| add a `--quiet` flag to the doctor command | 50 | 0.34 | **premium** | mid |
| fix the off-by-one in the impact top-N slice | 60 | 0.39 | **premium** | mid |
| add a retry with backoff to the auth token refresh | 78 | 0.00 | **mid** | cheap |
| extract the render helpers into their own module | 50 | 0.26 | **premium** | mid |
| redesign how the gate decides merge readiness | 44 | 0.74 | premium | premium |
| add multi-tenant permissions to the whole MCP surface | 59 | 0.43 | **premium** | mid |

One defect, and it is another instance of the same lesson: **do not charge for
the same uncertainty twice.**

`confidence` was `Math.min` of both Score answers, and a value under the floor
bumped a tier. Two things were wrong with that.

It **discarded the confident answer.** Take `rename the variable running to
score in model-route.js`. Jev put the entire distribution — 1.00, confidence
1.00 — on *"the request names the exact file, symbol, flag or user-visible
string to change"*, which is exactly what that sentence does. `blast_radius`
put 0.80 on *"contained to a single file"* at confidence 0.54. Both answers say
trivial. The minimum kept 0.54, missed the floor by one hundredth, and routed a
one-file rename to the premium tier. A perfectly certain answer had no effect on
its own tier because a second question was a hundredth less sure.

It **double-counted.** `score` is the expectation over that question's own level
distribution, so a spread answer already pays through its own term — 1.56 out of
2 on blast radius, for the `--quiet` flag, is most of a −20% share. Bumping a
tier on the spread as well charged for it twice.

The fix is to leave confidence where it belongs: each answer's uncertainty is
priced into that answer's own term, and confidence is reported for a reader
rather than read by the router. Same Jev answers, rescored: escalation 67% → 0%,
premium 6/9 → 1/9.

The remaining bumps — `no evidence` and `risk path` — are otito's own
deterministic repository signals, which is the half of this pairing that is
entitled to overrule a model. A vendor's self-reported certainty is not.

The auth request moving to `cheap` is that division working, not a hole in it:
`risk path` did not fire because this repository has no auth code for otito to
match. In a repository that has some, the flag fires on repository evidence.

What this run does **not** fix: the route score still separates the corpus
poorly. An auth retry (78) reads as cheaper than sorting imports in one file
(61), and a README typo (54) reads as more expensive than both. That is question
quality and AX dominance, not the confidence defect, and it is unmeasured
against outcomes like everything else below.

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

## References

- TypeSafe AI, _System One_: <https://docs.typesafe.ai/concepts/system-one>
- TypeSafe AI, _Composite scoring_: <https://docs.typesafe.ai/patterns/composite-scoring>
- TypeSafe AI, _Confidence_: <https://docs.typesafe.ai/confidence>
- otito, [Calibration Thesis](../17-calibration-thesis/README.md)
- otito, [Deterministic Verification](../07-deterministic-verification/README.md)
- Implementation: `src/lib/model-route.js` and `src/lib/render/route.js`, reachable as `otito route`
- `scripts/model-route.mjs` is a thin wrapper kept for the 1.12.0 prototype invocation
- Host-agnostic skill: `codex/skills/model-router/`
