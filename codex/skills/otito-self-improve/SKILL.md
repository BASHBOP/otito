---
name: otito-self-improve
description: >-
  Self-evaluates otito context packs against expected files/symbols, records labeled gaps as eval corpus cases, and implements ranking/extractor fixes when retrieval fails. Use when otito missed the right file, hotspots were wrong, the user says otito was not useful, or asks to self-evaluate / auto-improve otito. Default mode is gated: detect → eval case → fix → verify; commit/PR only when the user asks.
---

# otito self-evaluate + auto-improve

Close the loop when `context_pack` / `otito context` is a weak map: turn the miss into a labeled regression, fix the engine, prove it, then stop for commit approval.

## Default autonomy (gated)

1. Detect and score the gap.
2. Add or update an accuracy eval case (fixture when possible; live-repo note when not).
3. Implement the smallest ranking/extractor fix in `/Users/segzy/dev/otito`.
4. Re-run targeted tests + `npm run eval:accuracy` (or the skill script).
5. Report before/after. **Do not commit or open a PR unless the user asks.**

Do **not** silently lower corpus thresholds to make a bad pack pass.

## When to run

- User says otito missed / was not useful / should self-improve.
- After a task where the agent needed grep because hotspots/primary files were wrong.
- After changing `src/lib/context-engine.js`, `src/lib/code-map/ast.js`, or index cache version.

## Inputs to capture

From the failed task, record:

| Field                         | Example                                                  |
| ----------------------------- | -------------------------------------------------------- |
| `query`                       | extend organisation branding to RSVP … emails            |
| `repoPath`                    | `/Users/segzy/dev/bashbop-api`                           |
| `expectedPrimary`             | `src/email/email.service.ts`                             |
| `expectedHotspots` (optional) | `sendRsvpConfirmationEmail`, `resolveEventEmailBranding` |
| `notExpectedTop` (optional)   | dump of unrelated controllers that dominated             |

If the user did not label expected files, infer from what the agent actually edited, then confirm in the report.

## Procedure

### 1) Score the gap

Prefer the helper (from a otito checkout):

```bash
node /Users/segzy/dev/otito/codex/skills/otito-self-improve/scripts/score-gap.mjs \
  --query "…" \
  --path /path/to/repo \
  --expect-primary "src/email/email.service.ts" \
  --expect-hotspot "sendRsvpConfirmationEmail" \
  --json
```

Or equivalent MCP/`otito context … --json` and check:

- Is each `expectedPrimary` in `primaryFiles` (top 5 ideal)?
- Is each `expectedHotspot` in `hotspots`?
- Did an unrelated domain take > half of primary slots?

A **gap** is any expected primary missing from top 8, or expected hotspot missing while the file exists in the index.

### 2) Classify the root cause

| Symptom                                            | Likely fix area                                                         |
| -------------------------------------------------- | ----------------------------------------------------------------------- |
| File not in index / zero methods on a Nest service | `src/lib/code-map/ast.js` (+ bump `cacheVersion` in `index-cache.js`)   |
| File indexed but low score / wrong primary order   | `src/lib/context-engine.js` scoring / diversify / caps                  |
| Plural / British spelling miss                     | `tokenVariants` in context-engine                                       |
| Cross-repo miss                                    | workspace pack / multi-path `context`                                   |
| One-off product knowledge                          | do **not** hardcode BashBop paths; add a fixture or corpus case instead |

### 3) Lock the gap as an eval

Prefer fixture-backed cases under `evals/fixtures/` + `evals/corpus.json` (see `docs/EVALS.md`).

Minimal retrieval case shape:

```json
{
  "name": "short-kebab-name",
  "query": "…",
  "repoFixture": "sample-api",
  "expectedPrimary": ["src/…/….ts"]
}
```

For Nest method hotspots, extend a small fixture service with named methods rather than depending on live BashBop trees in CI.

If only a live repo can reproduce today: keep a markdown note under `codex/skills/otito-self-improve/gaps/` with query + expected paths, and still add the smallest fixture that encodes the same shape.

### 4) Implement the fix

Work only in the otito checkout (`/Users/segzy/dev/otito` unless the user moved it).

- Smallest change that makes the new case pass.
- Update unit tests next to the change (`tests/context-engine.test.js`, `tests/code-map.test.js`, …).
- If map shape changed, bump `cacheVersion` so disk indexes regenerate.
- Update `CHANGELOG.md` `[Unreleased]`.

### 5) Verify

```bash
cd /Users/segzy/dev/otito
node --test tests/code-map.test.js tests/context-engine.test.js tests/index-cache.test.js
npm run eval:accuracy
# re-score the original gap
node codex/skills/otito-self-improve/scripts/score-gap.mjs --query "…" --path "…" --expect-primary "…" --expect-hotspot "…" --json
```

Pass criteria: gap script `ok: true`, accuracy eval exit 0, targeted unit tests green.

### 6) Report (always)

```markdown
## otito gap report

- Query: …
- Before: primary=[…]; hotspots=[…]
- Gap: …
- Root cause: extractor | scoring | cache | other
- Fix: files touched
- After: primary=[…]; hotspots=[…]
- Eval case: name / still pending
- Next: ask to commit/PR (do not push unless asked)
```

## Hard rules

- Never invent product secrets or lower accuracy floors to hide a miss.
- Never “fix” usefulness by hardcoding a single company’s absolute paths into the scorer.
- Prefer fixtures + corpus over live-only heuristics.
- Treat generated context as a map; the skill improves the map, it does not replace reading code.
- Co-author trailers: follow user git rules (no Cursor co-author).

## Sync to Cursor

From the otito checkout:

```bash
codex/skills/otito-self-improve/scripts/sync-installed.sh
```

Installs to `~/.cursor/skills/otito-self-improve` (and `~/.codex/skills/otito-self-improve` when present).
