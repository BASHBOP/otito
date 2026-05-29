# 🧬 repoctx Absorption Study

**Date:** 2026-05-29
**Author:** Claude (with Oluwasegun Olumbe)
**Status:** Phase 1 implementation paused mid-flight to capture this record.

This document captures the field test, design decisions, and refined plan for
absorbing **`impact-map`** (Python) and **`pullpass`** (Go) into **`repoctx`**
(TypeScript/Node) so there is one local-first tool, one binary, one MCP server,
and one risk vocabulary.

---

## 📋 Table of contents

1. [The three tools, briefly](#-the-three-tools-briefly)
2. [Decisions taken](#-decisions-taken)
3. [Field test — bashbop-api](#-field-test--bashbop-api)
4. [Performance](#-performance)
5. [Five lessons from running them](#-five-lessons-from-running-them)
6. [Refined absorption plan](#-refined-absorption-plan)
7. [Phase 1 status](#-phase-1-status)
8. [Open follow-ups](#-open-follow-ups)

---

## 🧰 The three tools, briefly

| Tool | Stack | Core LOC | What it does |
|---|---|---|---|
| **repoctx** | TS/Node | ~7,000 | Repo indexing, AST code map, context packs, PR review, MCP server |
| **impact-map** | Python | ~1,200 | "English change request → likely files + tests + risks" |
| **pullpass** | Go | ~2,500 | "Can this PR merge?" → PASS/WARN/FAIL with policy profiles |

Key observation discovered while reading the source: **`pullpass`'s local
evaluator already shells out to `repoctx context` and `repoctx pr` as its
"Context Evidence"** ([`pullpass/internal/local/evaluate.go:65-70`][pp-evidence]).
The dependency arrow already points toward repoctx. Absorption is reversing a
relationship that is halfway there.

[pp-evidence]: file:///Users/segzy/projects/pullpass/internal/local/evaluate.go

---

## ✅ Decisions taken

| Question | Choice | Rationale |
|---|---|---|
| **Absorption mode** | Port logic to TypeScript | One install, one binary, one MCP server. Kills cross-runtime friction. |
| **Standalone repos** | Archive after migration | Avoid dual maintenance. Existing installs keep working; READMEs point to repoctx. |

### Output style
User requested "very fancy and nicely formatted with emojis etc." → the new
renderer (`src/lib/render/fancy.js`) becomes the default; plain mode via
`--no-emoji` (or `NO_EMOJI=1`) for CI logs.

---

## 🔬 Field test — bashbop-api

Repo: `/Users/segzy/projects/bashbop-api` (NestJS, Prisma, Stripe SDK,
3,140 source-like files, payment-heavy).

### 🎯 Query 1 — "add Stripe refunds to bookings"

| Rank | 🐍 impact-map | 📦 repoctx context |
|---|---|---|
| 1 | ❌ `documentation/styles/stripe.css` (score 128) | ✅ `scripts/sync-database-with-stripe.ts` (50) |
| 2 | ❌ `scripts/check-orphaned-bookings-in-stripe.js` (119) | ✅ `src/guests/dto/guest.update.dto.ts` (34) |
| 3 | ✅ `src/booking/booking.controller.ts` (112) | 🎯 **`src/payment/processors/stripe.processor.ts`** (34) |
| 4 | ❌ `documentation/controllers/StripeController.html` (102) | ✅ `src/booking/booking.controller.ts` (31) |
| 5 | ❌ `src/scripts/stripe-db-sync-matcher.js` (100) | — |

> 🚨 impact-map ranked a **generated CSS file** as the #1 owner of
> "add Stripe refunds." The real owner `stripe.processor.ts` appears in
> repoctx's top 3 but not in impact-map's top 8.

**Why it happened** — [`scoring.py:170`][impact-scoring] gives
`path matches: stripe` +9 per token, plus a +4 "configuration/domain hint"
because `stripe` is in `CONFIG_HINTS`, plus an **+88 import-graph boost** from
sibling files. No domain or kind awareness penalises `documentation/` or `.css`.

[impact-scoring]: file:///Users/segzy/projects/impact-map/src/change_impact_analyzer/scoring.py

### 🎯 Query 2 — "fix Apple sign-in token validation"

| Rank | 🐍 impact-map | 📦 repoctx context |
|---|---|---|
| 1 | ❌ `src/shared/validation/currency-validation.service.ts` (49) | ❌ `src/shared/validation/currency-validation.service.ts` (59) |
| 2 | ❌ `documentation/injectables/CurrencyValidationService.html` (35) | 🎯 **`src/authentication/auth.controller.ts`** (50) |
| 3 | ❌ `documentation/interfaces/WebhookValidationResult.html` (35) | ✅ `src/guests/guest.controller.ts` (28) |
| 4 | ❌ `documentation/interfaces/CurrencyValidationResult.html` (34) | ✅ `src/utils/pipes/sanitizing-validation.pipe.ts` (25) |

> Both tools overweight "validation". repoctx **recovers** with the auth
> controller at #2; impact-map's top 4 is dominated by generated HTML docs.

### 🛡️ pullpass — auth + Prisma migration diff (HEAD~5)

```text
Verdict: WARN
✅ Changed files          9 files
✅ Secret safety          no secrets touched
⚠️  Risk review           5 sensitive paths (prisma/*, auth.controller.ts, config schema)
✅ Release discipline     no version bump expected
✅ Validation commands    yarn test · yarn lint · yarn check:type
✅ Dependency audit       commands available
⚠️  Review state          local mode can't verify approvals
✅ Policy profile         standard
```

### 🧪 repoctx pr — same diff

```text
Risk: high (11)
Changed Domains: prisma (3, +2997/-1), authentication (1, +287/-0), user, config, utils, test
Risk Flags: auth/security · data model · large PR · large file diff · request surface
Review Targets: 20 auth routes mapped to auth.controller.ts
Verification: yarn lint · yarn check:type · yarn test · yarn test:e2e · yarn build
```

🤝 **Verdict**: complementary, not competing. `pullpass` gives a clean verdict;
`repoctx pr` gives rich context. After absorption these merge into
`repoctx review`.

---

## ⚡ Performance

Same repo, same query, cold-ish runs:

```text
impact-map . "fix Apple sign-in token validation" --top 5 --json   →   8.99s
repoctx context "fix Apple sign-in token validation" --json        →   1.72s
                                                              5.2× faster
```

- impact-map re-scans every call.
- repoctx caches `.dev-context/index.json` and refreshes incrementally.

For an MCP server called repeatedly by an agent, this is a material UX win.

---

## 🧠 Five lessons from running them

### 1. 🪦 impact-map's scanner is the actual problem
The scoring formula isn't bad — what kills it is the **regex scanner** treating
`.css`, `documentation/*.html`, and one-off `scripts/*.js` as first-class
source files. repoctx's AST-backed code map already knows
`kind: source/scripts` vs `kind: controller/authentication`.
**Absorbing impact-map = throwing away `scanner.py` + `extractors.py` and
reusing `code-map.js`.** Only ~250 LOC of `scoring.py` + `text.py` +
`validation.py` is actually worth porting.

### 2. 🎯 Add `kind/domain`-aware penalties to scoring
After absorption, scoring should consume repoctx's `kind` field directly:

```js
// pseudo
penalty if kind starts with 'source/docs' or path starts with 'documentation/'
penalty if extension in {.html, .css} unless query mentions ui/style/css
boost   if kind matches one of: controller, service, processor, dto
```

This single change would have moved `stripe.processor.ts` to #1 in Query 1.

### 3. 🪞 The "Apple → auth" gap is real
Neither tool knows that "Apple sign-in" is an auth concept. A small
**synonym/concept map** would help both:

```text
apple | google | oauth | sso          → boost auth domain
refund | chargeback | invoice         → boost payment domain
otp | 2fa | verify | mfa              → boost auth domain
```

This belongs in `src/lib/risk-paths.js` next to the shared keyword list — same
vocabulary, two uses.

### 4. 🤝 `pullpass` + `repoctx pr` should merge, not compete
pullpass's `Context Evidence` block literally tells the user to run
`repoctx pr`. After absorption that becomes:

```bash
repoctx review .  →  runs map + impact + pr + pass, one verdict
```

pullpass is essentially **the verdict layer wrapping `repoctx pr`**. Putting
them in one binary removes the "install Go just to get PASS/WARN/FAIL"
friction.

### 5. ⚡ Speed gap is mostly Python startup + re-scan
The 5.2× gap isn't even Python vs Node — it's `repoctx` having a cached
`.dev-context/index.json` it can refresh incrementally vs `impact-map`
cold-walking the FS every call. After absorption, `repoctx impact` inherits
the cache for free.

---

## 🪜 Refined absorption plan

### Phase ordering

| Phase | Work | ~LOC | ~Days |
|---|---|---|---|
| **1. Shared risk + fancy renderer** 🎨 | `src/lib/risk-paths.js`, `src/lib/render/fancy.js`, retrofit `doctor` as demo | ~400 | 1–2 |
| **2. Absorb impact-map** 🐍 → 📦 | `src/lib/impact.js` (port `scoring.py` + `text.py` + `validation.py`), `repoctx impact` command, MCP tool, `--diff-base` validation, kind/domain penalties | ~500 | 2–3 |
| **3. Absorb pullpass local** 🐹 → 📦 | `src/lib/pass-local.js`, `policy.js`, `codeowners.js`, `release-check.js`, `repoctx pass` command | ~800 | 3–4 |
| **4. Absorb pullpass PR + composite** 🚀 | `src/lib/pass-pr.js` (`gh` integration, 856 LOC ported), `repoctx review` composite, MCP `review_pr` tool | ~900 | 3–5 |

### What to keep vs. drop from impact-map

| Keep ✅ | Drop ❌ |
|---|---|
| Weighted-token scoring formula (`scoring.py:176-241`) | `scanner.py` — repoctx's `code-map.js` is AST-backed |
| Dependency boost via import graph (`scoring.py:272-305`) | `extractors.py` — repoctx already extracts imports/routes/symbols |
| `text.py` stop-words, singularize, domain keywords | `report.py` — repoctx has its own renderer |
| Validation against git diff (`validation.py`, ~68 LOC) | Standalone scanner, CLI, MCP entrypoint |

### What to keep from pullpass

| Module | New file | Why keep |
|---|---|---|
| `internal/local/evaluate.go` | `src/lib/pass-local.js` | Local merge gate (secret/risk/validation/audit) |
| `internal/githubpr/evaluate.go` (856 LOC!) | `src/lib/pass-pr.js` | `gh`-driven review decision, mergeability, status checks, conversations |
| `internal/codeowners/codeowners.go` | `src/lib/codeowners.js` | Pattern matching + team membership |
| `internal/policy/policy.go` | `src/lib/policy.js` | `standard` / `company` / `high-risk` profiles |
| `internal/rules/rules.go` | merge into `src/lib/risk-paths.js` | Unified risk vocabulary |
| `internal/release/check.go` | `src/lib/release-check.js` | Release-discipline rules |

### CLI shape after absorption

```bash
repoctx impact . "add Stripe refunds to bookings"             # ← was: impact-map
repoctx impact . "fix auth redirect" --diff-base HEAD --json

repoctx pass . --base origin/main                             # ← was: pullpass local
repoctx pass . --policy high-risk --governance team
repoctx pass-pr 123 --comment                                 # ← was: pullpass pr
repoctx pass-pr --governance solo

repoctx review . --base origin/main --request "add refunds"   # 🚀 NEW: composite
# runs: code-map → impact → pr → pass, returns one verdict
```

### Fancy output preview

```text
╭─────────────────────────────────────────────────────────────╮
│  📋  repoctx pass · merge readiness                         │
│  📂  ~/projects/bashbop-api                                  │
│  🔀  HEAD vs origin/main · 14 changed files · policy: high-risk
╰─────────────────────────────────────────────────────────────╯

  ✅ Changed files          14 files scoped to api/, tests/
  ✅ Secret safety          no .env or credential paths touched
  ⚠️  Risk review           5 sensitive paths changed
     └─ 💳 src/payments/refund.ts
     └─ 🔐 src/auth/session.ts
     └─ 🗄️  prisma/schema.prisma
  ✅ Release check          CHANGELOG.md updated for 1.4.0
  ✅ Validation commands    npm run ci · npm test · npm run lint
  ✅ Dependency audit       package-lock.json present
  ❌ Review state           CODEOWNERS approval missing for prisma/
  ⚠️  Policy profile        high-risk: record specialist sign-off

╭──────────────────────────────────────────╮
│  🚦  VERDICT     ❌  FAIL                 │
│  ⛔  blocked by  Review state             │
│  📝  next step   request @data-team review │
╰──────────────────────────────────────────╯
```

---

## 🚧 Phase 1 status

Phase 1 work was started and paused for this writeup. Task list:

| # | Task | Status |
|---|---|---|
| 1 | Read existing risk-flag logic in `pr-review.js` | ✅ done |
| 2 | Create `src/lib/risk-paths.js` shared policy module | ⏳ pending |
| 3 | Create `src/lib/render/fancy.js` renderer | ⏳ pending |
| 4 | Retrofit `doctor` command as fancy-renderer demo | ⏳ pending |
| 5 | Add tests for risk-paths and fancy renderer | ⏳ pending |
| 6 | Run full repoctx CI gate (`npm run ci`) | ⏳ pending |

### Existing repoctx risk vocabulary (preserve in `risk-paths.js`)

Discovered in [`src/lib/pr-review.js:742-767`](file:///Users/segzy/projects/repoctx/src/lib/pr-review.js):

```text
request surface          ← route | apiRoute | controller kinds
frontend/backend contract ← apiClient kind
data model               ← schema kind, prisma | migration paths
auth/security            ← auth | session | jwt | permission | role | password | token
money flow               ← payment | billing | checkout | webhook | stripe | refund
configuration            ← config kind, package.json | lock | docker | configs | env
large file diff          ← additions + deletions ≥ 300
```

This is more semantic than impact-map's `RISK_KEYWORDS` ("payments",
"database") or pullpass's `riskPathParts` ("stripe", "prisma"). The shared
module should keep repoctx's vocabulary and **map the other tools' lists to
these canonical flags**.

### Glyph mapping for the renderer

| Flag | Glyph |
|---|---|
| auth/security | 🔐 |
| money flow | 💳 |
| data model | 🗄️ |
| request surface | 📡 |
| frontend/backend contract | 🔗 |
| configuration | ⚙️ |
| large file diff | 📦 |
| secret risk | 🚨 |

Status glyphs: ✅ pass · ⚠️ warn · ❌ fail · 🚦 verdict · 🎯 primary · 🥇🥈🥉 ranks.

---

## 🔭 Open follow-ups

- **Verify findings on a Next.js repo** (`snapabird-web`) to make sure the
  documentation/* overweighting is a NestJS-specific artifact or a general
  problem.
- **Confirm CODEOWNERS team-membership scope** — needs a GitHub token with
  `read:org`. Document in the new `repoctx pass-pr` help.
- **Decide `repoctx context` deprecation path** — `impact` and `context`
  answer the same question with different vocabularies. Likely
  `context` becomes an alias for `impact` in the next major.
- **Confirm tool name `pass-pr`** vs alternatives (`pass --pr 123`,
  `pass remote`, `review`). Current docs assume `pass-pr` but it's not
  shipped yet.

---

## 📎 Source files referenced

| File | Purpose |
|---|---|
| `/Users/segzy/projects/impact-map/src/change_impact_analyzer/scoring.py` | Scoring formula to port |
| `/Users/segzy/projects/impact-map/src/change_impact_analyzer/text.py` | Tokenizer + domain keywords |
| `/Users/segzy/projects/impact-map/src/change_impact_analyzer/validation.py` | Diff-validation feature |
| `/Users/segzy/projects/pullpass/internal/local/evaluate.go` | Local merge gate |
| `/Users/segzy/projects/pullpass/internal/githubpr/evaluate.go` | `gh`-driven PR mode |
| `/Users/segzy/projects/pullpass/internal/policy/policy.go` | Policy profiles |
| `/Users/segzy/projects/pullpass/internal/rules/rules.go` | Risk path list |
| `/Users/segzy/projects/pullpass/internal/codeowners/codeowners.go` | CODEOWNERS parser |
| `/Users/segzy/projects/repoctx/src/lib/pr-review.js` | Existing risk-flag inference (preserve vocabulary) |
| `/Users/segzy/projects/repoctx/src/lib/context-engine.js` | Existing task-context engine that impact will merge with |
| `/Users/segzy/projects/repoctx/src/lib/code-map.js` | AST code map that replaces impact-map's scanner |
