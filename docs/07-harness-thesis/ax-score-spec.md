# Spec: Agent Experience (AX) Score

**Status:** Implemented — task mode (`otito ax`). Repo mode + `ax_score` MCP tool pending.
**Owner:** TBD
**Depends on:** `src/lib/tokens.js`, `src/lib/impact.js`, `src/lib/review.js`, `src/lib/risk-paths.js`, `src/lib/codeowners.js`, `src/lib/policy.js`
**Implementation:** `src/lib/ax.js` (`generateAxScore`), CLI `otito ax`, tests in `tests/ax.test.js`.

> **What shipped vs. this spec.** Task-mode scoring, the four sub-scores, drivers,
> recommendations, and the JSON/markdown output are implemented. Two deliberate
> deviations: (1) the fourth guardrail is **CI workflow present** (a local,
> deterministic check) rather than live branch protection via `policy.js`, which
> needs a remote `gh` call and would break the local-first/offline guarantee;
> (2) blast-radius file count uses the score "elbow" (files within half the top
> match's score) instead of the raw `top` count, which is just the requested list
> size. AX is exposed over MCP as the `agent_experience` tool, the deliberate
> 12th entry on a surface that was previously contract-locked at 11 (the count is
> guarded by three tests + the migration doc).

## 1. Summary

Add an **Agent Experience (AX) score**: a single 0–100 number answering
_"how cheap and safe is it for an agent to make a change here?"_ for a given task or path.

It is the measurable form of the harness thesis (see
[README.md](./README.md), lesson 2): a better codebase needs **fewer tokens** and has
**better guardrails**, so a cheaper model can do the same work. The AX score rises as the
harness improves and falls when the codebase is hard to change. No competing tool ships this.

Two framings, same engine:

- **Task AX** — `otito ax "<task>" --path .` — how agent-friendly is _this change_?
- **Repo AX** — `otito ax --path .` — aggregate agent-friendliness of the repo, sampled
  across representative tasks/paths.

## 2. Why this is low-risk to build

Every input already exists; AX is a composition layer, not new analysis:

| Signal | Source (already in repo) |
| --- | --- |
| Token cost of the context an agent needs | `estimateTokenSections` / `estimateTokens` — `src/lib/tokens.js`; surfaced as `data.tokenEstimate` in `generateImpact` |
| Blast radius (files touched, dependency fan-out) | `generateImpact(query, opts).data.topFiles[]` (`score`, `relatedFiles`, `riskFlags`) — `src/lib/impact.js` |
| Risk density | `classifyPath` / `RISK_FLAGS` — `src/lib/risk-paths.js`; `risks` array on impact data |
| Guardrail: tests exist for the change | `data.testSuggestions` + test-kind files in `topFiles` |
| Guardrail: validation commands exist | `data.validation` from impact / harness |
| Guardrail: ownership is resolvable | `src/lib/codeowners.js` |
| Guardrail: branch protection configured | `src/lib/policy.js` |
| Precedent for a 0–100 composite | `computeConfidence` in `src/lib/review.js` (already blends verdict + concepts + risk) |

## 3. Score model

AX is a weighted blend of four sub-scores, each normalised to 0–100. Weights are config-
overridable (`src/lib/config.js`) so teams can tune them; defaults below.

```
AX = 0.35 * Changeability   // inverse of token cost to make the change
   + 0.30 * Containment     // small, low-fan-out blast radius
   + 0.25 * Guardrails      // tests + validation + owners + protection present
   + 0.10 * Clarity         // concepts resolved, risk flags low
```

### 3.1 Changeability (inverse token cost)

Lower tokens-to-change is better — this is Pocock's "employ a stupider model" lever.

```
tokens   = impact.data.tokenEstimate.total      // context-pack tokens for this task
Changeability = clamp( 100 - 100 * log10(tokens / FLOOR) / log10(CEIL / FLOOR), 0, 100 )
// FLOOR = "ideal" pack (e.g. 1_500 tokens) → ~100; CEIL = "bloated" (e.g. 40_000) → ~0
```

A log curve keeps small differences near the good end from dominating.

### 3.2 Containment (blast radius)

```
N        = impact.data.topFiles.length
fanOut   = mean(topFiles[i].relatedFiles.length)
Containment = clamp(100 - (N * w_n + fanOut * w_f), 0, 100)
```

Small, well-isolated changes score high; changes that ripple across many dependents score
low — directly rewarding good module boundaries.

### 3.3 Guardrails (boolean coverage, 25 pts each)

- tests exist for the touched area (`testSuggestions` non-empty AND ≥1 test-kind file near `topFiles`)
- validation commands resolve (`data.validation` non-empty)
- ownership resolves for touched paths (`codeowners.js`)
- branch protection / required checks configured (`policy.js`)

### 3.4 Clarity

```
Clarity = 100
        - (concepts.length === 0 ? 40 : 0)          // task couldn't be grounded
        - min(40, riskFlagDensity * 100)             // share of topFiles carrying RISK_FLAGS
```

## 4. Output schema

```jsonc
{
  "ok": true,
  "generatedAt": "2026-06-20T...Z",
  "axEngineVersion": "0.1.0",
  "mode": "task",                  // "task" | "repo"
  "query": "add a new MCP tool",
  "repo": { "name": "otito", "root": "/..." },
  "ax": 78,                        // headline 0–100
  "band": "good",                  // poor | fair | good | excellent
  "subScores": {
    "changeability": 84,
    "containment": 72,
    "guardrails": 75,
    "clarity": 80
  },
  "drivers": {                     // why the score is what it is
    "tokensToChange": 4200,
    "filesTouched": 6,
    "meanFanOut": 2.1,
    "guardrails": { "tests": true, "validation": true, "owners": true, "branchProtection": false }
  },
  "recommendations": [             // actionable, ranked harness fixes
    "Enable branch protection on main to gate AFK merges (+6 AX).",
    "Add a test near src/lib/foo.js; this area has no coverage (+8 AX)."
  ],
  "tokenEstimate": { "fullJson": 0 }
}
```

`recommendations` is the payoff: every missing guardrail or oversized context pack becomes a
concrete, point-valued harness improvement — the self-improving loop from lesson 7.

Renderers mirror the existing review surface: a terminal view (`src/lib/render/fancy.js`,
matching `formatReviewTerminal`) and an optional Mermaid/HTML view for PR artifacts.

## 5. Surface

### CLI

```bash
otito ax "add a new MCP tool" --path .        # task AX
otito ax --path . --json                       # repo AX, machine-readable
otito ax . --base origin/main                  # AX of the current diff
```

### MCP tool

Add `ax_score` to `src/lib/mcp.js`, mirroring `review_gate`. Keep the description tight —
per lesson 4, every tool description is permanent context cost. One sentence:

> `ax_score` — score how cheap and safe it is for an agent to make a change (0–100), with
> ranked harness fixes.

## 6. Implementation phases

1. **Engine** — `src/lib/ax.js`: `generateAxScore(query, options)` composing the existing
   functions; pure, deterministic, unit-testable. No new analysis.
2. **CLI** — wire `ax` command in `src/cli.js`; Markdown + `--json`.
3. **Renderer** — terminal view via `fancy.js`; reuse band glyphs from review.
4. **MCP** — register `ax_score`; add to `agent-tools.js` metadata.
5. **Repo mode** — sample representative paths/tasks, aggregate to a repo headline.
6. **Recommendations** — map each failing sub-signal to a point-valued fix string.

## 7. Tests (per repo convention, `tests/*.test.js`)

- Deterministic: same input → same score (matches the local-first/deterministic guarantee).
- Monotonic guardrails: enabling branch protection / adding tests never lowers AX.
- Token monotonicity: larger context pack → lower Changeability, all else equal.
- Schema: output validates; `ax` and every sub-score are integers in 0–100.
- Snapshot AX for this repo to catch unintended drift, gated in `npm run eval:accuracy`.

## 8. Open questions

- **Weights & constants** (FLOOR/CEIL, `w_n`, `w_f`): defaults above are placeholders; calibrate
  against a few known-good and known-painful repos before locking.
- **Repo-mode sampling**: which tasks/paths represent a repo fairly? Start with top domains
  from the code map; revisit.
- **Tokenizer fidelity**: `tokens.js` uses `ceil(chars / 4)`. Fine for relative scoring; if
  absolute token budgets matter later, swap in a real tokenizer behind the same interface.
- **Gaming**: AX should reward real changeability, not deletion of useful context. Containment
  and Guardrails counterbalance a pure token-minimisation incentive.
