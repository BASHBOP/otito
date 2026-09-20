# Jev maximisation + visual legibility — session brief

> Working plan, untracked. Delete it or graduate it into `docs/` once the work lands. Written 2026-09-20 at the end of the session that built the Realtime Canvas.

## Objective

Extract substantially more from each Jev call, and make the resulting decision **visible** — without moving one inch away from determinism.

## The boundary (non-negotiable, read this first)

otito's purity is protected by **location and write-direction**, not by asking Jev fewer questions:

- The gate never asks. The router lives in `scripts/` + `src/lib/model-route.js` and writes nothing any gate reads.
- The canvas (`~/dev/otito-canvas`) is a separate package that imports otito read-only.
- Therefore: **more Jev questions cost nothing in determinism.** What would break it is write-direction — Jev answers shaping what otito indexes or caches, or a recorded tier feeding back into risk weights. That is the parked item 10 and it stays parked.

Every number stays measured-or-null. The router stays **advisory**.

## Current state — what is actually unused

| Fact | Evidence |
| --- | --- |
| Jev returns a calibrated **distribution** over levels; the arithmetic reads a scalar | `nameProbabilities` normalises it at `src/lib/model-route.js:206`; `scoreDecision` (`:340`) uses `score / 2`; the distribution survives only as a display string at `src/lib/render/route.js:46` |
| Confidence is read once, as a binary bump | `CONFIDENCE_FLOOR` 0.55 in `scoreDecision` |
| otito sends `likely_files` as **state** but never asks a question about them | `askJev` state block, `src/lib/model-route.js:~220` |
| No Jev answer has ever been graded against an outcome | `docs/18-model-routing/README.md` "What is not true yet" |

## Work

### A. Consume the whole distribution

Replace the `score / 2` midpoint with terms read off the probability mass (e.g. `P(cross-cutting)` for blast radius, `P(names a symptom)` for specificity). Same call, same tokens, more information. **Done when:** `scoreDecision` reads `probabilities`, the offline fallback still produces a comparable shape, and existing route tests pass unchanged or are updated with a stated reason.

### B. Ask Jev about otito's file set — the largest unused seam

Two new typed questions:

- `coverage`: does this file set plausibly cover the request?
- `missing`: does the request imply work these files do not cover?

This is the one judgement otito structurally cannot make about itself — it has never read the request as language. **Done when:** both questions ride the same single call, and their answers are advisory-only (they may inform the tier; they may never reach a gate).

### C. Use confidence as a weight, not a switch

Weight each term by the confidence Jev reported for it, instead of one below-0.55 tier bump. Offline answers carry `confidence: null` and must keep behaving as they do today (no bump on an absent number).

### D. Grade the questions — the discipline that stops B being decoration

A question whose answers do not separate its inputs is noise with a decimal point. The original `specificity` Noul answered 0.57–0.81 for every prompt including a typo fix. **Done when:** a small harness runs a prompt corpus and reports per-question spread; a question that does not discriminate gets cut, in writing.

## Visual work (the canvas already carries the data)

- **V1 — the routing waterfall.** `scoring.steps` already holds `{label, detail, delta, from, to}` for AX → shares → containment → score. Draw it as a waterfall so a tier is legible at a glance instead of read as text. Highest value per unit of work: the data is already there.
- **V2 — distributions, not points.** Render each Score answer as a stacked bar across its levels. This is what makes work item A visible.
- **V3 — confidence as a band**, not a number; and Jev's `coverage` verdict shown beside otito's predicted files.

## Open decisions for the new session

1. ~~`TYPESAFE_API_KEY` is not set.~~ **Settled 2026-09-20: the key is exported from `~/.zshenv` and verified live** — `otito route` returned `source: "jev"`, `model: jev-1.13.0`, 903 tokens, 569ms, $0.000038. A–D can be done against real answers. At ~900 tokens a call, a grading corpus of a few hundred prompts costs pennies, so cost is not a reason to work from fixtures.

   Watch for the silent fallback: nothing errors when the key is absent, the router just stamps `source: "offline"`. Check it with `grep -o '"source": *"[a-z]*"'` (the `--json` output is pretty-printed, so a pattern without the space after the colon never matches).

2. Whether A–C land as one change to `model-route.js` or as separate reviewable commits (recommend: separate; each changes the arithmetic).

## Verification

- otito: `npm run quality` (full — format, lint, typecheck, tests, coverage, evals, audit, smoke). Never a subset.
- canvas: `node --test tests/*.test.js` (53 tests) and `tsc --noEmit`.

## Context you will not find in the repos

- Canvas v0.1 lives at `~/dev/otito-canvas`, zero deps, **not yet committed**.
- It is an observer: eight stages (`received → classify → context → capability → route → execute → validate → result`), SSE + WebSocket, replayable JSONL log.
- Model lanes ship as `simulated` stand-ins that make no call. A live one is registered with `registerExecutor(lane, fn, { simulated: false })`.
- The agreed next step after "seamless capture" is the **backtest** (routing roadmap item 1): join runs to outcomes via the `otito calibrate` harness and measure **regret**, not accuracy.
