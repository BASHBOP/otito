# Dogfooding

> Running otito on real work, and writing down what it got wrong.

Each section below is one session of otito used as an agent's first tool on a
real repository, with the numbers that showed each defect. Router-specific
dogfood from earlier sessions lives on the
[Model Routing](../18-model-routing/README.md) page.

## Dogfood, bashbop-event-web, 2026-09-24

The whole loop, end to end: a Claude Code session on `bashbop-event-application`
v23.15.0 grounds every prompt in otito, and the Otito Realtime Canvas watches.
Every tool call below was made from that session. Its answers were checked
against the repository's own last commit, `e97946e1`
(*feat(people): rebuild People page around adding and messaging people*,
25 files).

### Setup

| Part | State |
| --- | --- |
| otito | v1.15.0 at `b055e34`, `npm link`ed from the dev checkout |
| MCP server | `node src/cli.js mcp`, with `OTITO_CANVAS_URL=http://127.0.0.1:7801` and `OTITO_HOST=claude-code` |
| Canvas | `otito-canvas` at `d86fd54` plus uncommitted work (duplicate folding, the `tool` field, the route `read`), pinned to the repo, `online: false` |
| Prompt hook | Claude Code `UserPromptSubmit` posts each prompt to `/ingest` with `source: claude-code` and no `tool`, then tells the agent to call otito first |

Each prompt reaches the canvas at least twice: once from the hook, then once
for every otito tool the agent calls.

### What the canvas has recorded

The canvas's own log (`.otito/canvas.jsonl`) holds 173 runs between
2026-09-20 13:43Z and 2026-09-24 20:45Z.

| Measure | Value |
| --- | --- |
| Runs by source | 111 `http:claude-code`, 54 `http`, 5 `demo`, 2 `http:canvas` (typed into the canvas), 1 `http:cursor` |
| Execution | 143 simulated (83%), 21 deterministic, 9 model lanes, 3 of those 9 failed |
| Router | Jev read the request on **1 of 173** runs; the rest were offline estimates |
| Tiers | 74 mid, 62 premium (36%), 34 cheap, 3 none |
| Bumps fired | 32 `risk path`, 26 `no evidence` |
| Run time | p50 439 ms, p90 3,965 ms, max 5,956 ms |

### Findings

**1. The canvas works out its own version of a run instead of showing the real one.**
A prompt's first post comes from the hook, with no tool name. When the agent then
calls `context_pack`, `agent_experience` and `model_route` with the same text,
all three are folded into that run within the 60 s window. The only trace is
`deduplicated: 3` on `/health`. Nothing is published, so the canvas never shows
which otito tools the agent actually called. When the agent rephrased and called
`change_impact`, the run recorded `tool: change_impact` but labelled its
capability `review_context`, because the canvas picked a capability of its own
from the risk flags. **An observer has to show what happened, not what it would
have done.**

**2. An empty answer passes validation.** The canvas's deterministic
`repo_search` lane is a stub that returns `primaryFiles: []`. Its
`cited files exist` check is skipped when nothing is cited, so the run is still
marked valid. All 21 deterministic runs in the log returned zero files, and all
21 passed.

**3. Two classifiers read the same sentence differently.** For the prompt
*"dog feed otito here and analyse how its use and workflow and canvas
realtime"*, `context_pack` reported intent `unknown`. The canvas's own regex
classifier said `explain` (it matched "how") and listed a stemmed `canva` as a
topic. The canvas should take otito's reading rather than keep its own.

**4. A framework filename outranks the feature.** For *"add people manually to
the audience from the People page"*, `change_impact` ranked
`app/organisation-audience/unsubscribe/[token]/page.tsx` first (83.9). Its
reasons were `path matches: audience, page` and `symbol matches: audience,
page`. In a Next.js App Router repository every route file is `page.tsx`, so
"page" is close to a stopword. The real owners came 3rd and 4th
(`OrganisationAudienceStudio.tsx`, `PeopleTable.tsx`), and `PersonDialog.tsx`,
where a person is actually added, only appeared among supporting files. The
wrong first file brought an `auth/security` flag with it, and that routed the
request to **premium**. The implementation plan also said to open the
unsubscribe page first. **A ranking error at position one spreads into every
signal built on top of it.**

**5. `top` is not a limit.** The same call with `top: 5` listed 17 files under
*Top Impacted Files*: the five ranked files and 12 supporting tests, all scored
16.8. The tests included `LoginPageClient.test.tsx` and
`PlanBillingPage.test.tsx`, and the second of those added a `money flow` risk
to a request that has nothing to do with money.

**6. `convergence_score` measures the working tree, not the commit.** Scoring
the commit's own subject against `HEAD~1` gave **55, partial** (coverage 100,
scope 21, risk alignment 15; receipt `rcpt_208b4349f49e`). It reported 29
changed files for a 25-file commit. The extra four were not in the commit:
two `.claude/agent-memory/` files, `.claude/settings.local.json`, and an
untracked `dump.rdb`, and all four were counted as scope drift. There is a
`staged` mode but no `head` ref, so a committed change cannot be scored cleanly
while the tree is dirty.

**7. A feature's own files count as drift.** Only one owner was predicted
(`PeopleTable.tsx`), so the commit's five test files, the six new components
next to it in `components/organisations/people/`, and
`features/dashboard/people.spec.ts` were all listed as unrequested changes. A
request to *rebuild a page* implies new siblings and tests for it. Those should
count as in scope.

**8. The model half of the canvas has barely run.** The `SessionStart` hook
that starts the canvas has no `TYPESAFE_API_KEY` in its environment, so
`online` is false and the route stage's request read, the canvas's newest
panel, has appeared once in 173 runs. All three failed model-lane runs were
Anthropic `401 API key is invalid`. Neither state is visible in the canvas
header.

One smaller readability point: `model_route` returns `hostModel:
"claude-sonnet-5"`. That is the model id for the recommended tier (mid) on
that host, but the field name reads like *the model the host is running*.
The agent in this session misread it that way at first.

### What worked

- The tap never delayed a tool call. It sends only to loopback, and a canvas
  that is down cannot reach the agent.
- A canvas opened mid-session filled in from its buffer, and a new run appeared
  over SSE within about a second of the tool call.
- `context_pack` flagged the meta prompt as ambiguous (`openQuestions`) instead
  of pretending to understand it. `agent_experience` gave one concrete
  recommendation, *add a CODEOWNERS file (+6 AX)*.
- Simulated and offline stages were labelled as such. Nothing claimed a model
  call that did not happen.

### Follow-up

| Finding | Where it gets fixed |
| --- | --- |
| 1, 2, 3, 8 | `otito-canvas`: show forwarded tool calls on the run they fold into, report the real tool as the capability, make an empty deterministic answer fail or warn, prefer otito's intent, show online and key state |
| 4, 5 | `src/lib/impact.js`: down-weight framework-conventional basenames (`page`, `layout`, `route`, `index`, ...), make `top` a limit or report supporting files separately |
| 6, 7 | `convergence_score`: add a `head` ref and bind the receipt to its tree, ignore untracked files by default, count new files next to a confirmed owner and tests of confirmed files as in scope |

### Reproduce the log numbers

From the `otito-canvas` checkout. The log keeps growing, so every count is
pinned to the window above:

```bash
L=.otito/canvas.jsonl
W='select(.ts < "2026-09-24T20:46:00Z")'
jq -r "$W"'|select(.stage=="received")|.source' $L | sort | uniq -c
jq -r "$W"'|select(.stage=="result")|"\(.status) \(.kind) \(.data.routeSource)"' $L | sort | uniq -c
jq -r "$W"'|select(.stage=="result")|.data.tier' $L | sort | uniq -c
jq -r "$W"'|select(.stage=="route")|.data.bumps[]' $L | sort | uniq -c
jq -r "$W"'|select(.stage=="execute" and .kind=="deterministic")|(.data.output.primaryFiles // [] | length)' $L | sort | uniq -c
jq -r "$W"'|select(.stage=="result")|.data.totalMs' $L | sort -n | awk '{a[NR]=$1} END {print "p50", a[int(NR*.5)], "p90", a[int(NR*.9)], "max", a[NR]}'
```

`/health` counts only since the canvas last started, so `deduplicated` and
`online` show the live state, not the window:

```bash
curl -s http://127.0.0.1:7801/health | jq '{online, stats}'
```
