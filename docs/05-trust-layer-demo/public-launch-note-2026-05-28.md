# Public Launch Note 2026-05-28

repoctx and PullPass are the first public pieces of a practical trust layer for AI-assisted software teams.

The point is simple:

```text
repoctx  -> context before change
PullPass -> validation before merge
Humans   -> accountability before release
```

AI can help teams move faster, but speed only matters if the work remains reviewable, testable, and accountable. The trust layer turns repository understanding and merge readiness into artifacts a maintainer can inspect, share, and defend later.

---

## What Is Public Now

| Piece | Current State | Evidence |
|-------|---------------|----------|
| repoctx | `v0.3.2` released | [repoctx v0.3.2](https://github.com/nugehs/repoctx/releases/tag/v0.3.2) |
| PullPass | `v0.8.0` released | [PullPass v0.8.0](https://github.com/nugehs/pullpass/releases/tag/v0.8.0) |
| PullPass policy profiles | Released in `v0.8.0` | [PullPass PR #7](https://github.com/nugehs/pullpass/pull/7) |
| PullPass dependency-audit signals | Released in `v0.8.0` | [PullPass PR #8](https://github.com/nugehs/pullpass/pull/8) |
| Proof run | Published | [2026-05-28 proof run](./proof-run-2026-05-28.md) |
| Company adoption case study | Published | [Company adoption case study](./company-adoption-case-study.md) |

---

## The Problem

AI-assisted development makes code changes cheaper to produce. That creates a new bottleneck: knowing whether a change is safe enough to merge.

Teams need answers before the merge button is pressed:

- What files and domains did this change touch?
- Which tests or validation commands matter?
- Did a reviewer approve the PR?
- Did CODEOWNERS review happen where required?
- Are conversations resolved?
- Is branch protection actually configured?
- Is this a normal team change, a solo owner decision, or a high-risk company change?

Without those answers, a repository can look productive while silently losing review discipline.

---

## The Trust-Layer Shape

repoctx handles context before change:

- repository shape
- code maps
- task-aware context packs
- PR review context
- workspace reports
- MCP tools for agents

PullPass handles validation before merge:

- changed files
- secret and risk path checks
- release discipline
- review decision
- CODEOWNERS approval
- review conversations
- branch protection
- status checks
- solo/team governance modes

Humans remain accountable:

- solo owner decisions are visible
- company review paths can require team evidence
- release notes and proof runs preserve the audit trail

---

## Why This Matters For Companies

The same workflow can serve a solo founder today and a company team later.

| Stage | Governance Shape |
|-------|------------------|
| Solo maintainer | Owner/admin decisions are allowed, but PullPass reports them as explicit warnings |
| Small team | Team mode requires review and CODEOWNERS approval |
| Company repository | Company policy requires PR-mode evidence, branch protection, resolved conversations, and passing checks |
| High-risk work | Sensitive paths require stricter review and a recorded specialist or owner decision |

That is the core product idea: a repository can grow from one accountable maintainer into a company-ready workflow without throwing away its operating model.

---

## How To Try It

Install repoctx from GitHub:

```bash
npm install -g github:nugehs/repoctx
repoctx doctor
```

Generate repository context:

```bash
repoctx context "ship the change" --path . --json
repoctx pr . --base origin/main --out .dev-context/pr-review.md
```

Run PullPass from a checkout:

```bash
go install github.com/nugehs/pullpass/cmd/pullpass@v0.8.0
pullpass local . --base origin/main
pullpass pr 123
```

For company or high-risk review gates:

```bash
pullpass pr 123 --governance team --policy company
pullpass pr 123 --governance team --policy high-risk
```

---

## What Is Next

1. Finish authenticated Bashbop-style API, web, and mobile proof runs.
2. Capture company feedback against the adoption case study.
3. Turn repeated proof runs into a small, public AI governance toolkit.
4. Keep repoctx and PullPass releases small, SemVer-tagged, and backed by proof artifacts.

This is the builder-founder path for the project: convert useful instincts into repos, tests, docs, releases, review gates, and evidence that another team can trust.

---

## Maintainer

Built and maintained by **Oluwasegun Olumbe**.
