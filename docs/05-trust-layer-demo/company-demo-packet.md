# Company Demo Packet

## repoctx + PullPass trust layer

Prepared by **Oluwasegun Olumbe**.

This packet is the short company-facing version of the repoctx and PullPass story. It is for engineering leaders, platform teams, developer-experience owners, and AI governance reviewers who need AI-assisted software work to stay understandable, reviewable, and accountable.

The operating promise:

```text
repoctx  -> context before change
PullPass -> validation before merge
Humans   -> accountability before release
```

## What To Send

Use these pages together when introducing the trust layer to a team.

| Page | Use it for |
| --- | --- |
| [Executive summary](../EXECUTIVE-SUMMARY.md) | The one-page product and governance overview |
| [Trust-layer walkthrough](./README.md) | The review rhythm: context, gate, human decision |
| [Company adoption case study](./company-adoption-case-study.md) | The screenshot-style story for managers and governance reviewers |
| [Company pilot runbook](./company-pilot-runbook.md) | The step-by-step checklist for running the first real repo and PR pilot |
| [Proof index](./proof-index.md) | The public/private evidence map for company review |
| [Review policy snapshot](./review-policy-snapshot.md) | The branch protection, required checks, CODEOWNERS, and review-rule evidence |
| [Company pilot feedback](./company-pilot-feedback.md) | The structured feedback loop for turning reviewer concerns into work |
| [Proof run](./proof-run-2026-05-28.md) | Dated evidence for repoctx, PullPass, release discipline, and Bashbop pilot proof |
| [Public launch note](./public-launch-note-2026-05-28.md) | The public release story and install path |
| [Builder-founder operating loop](../06-builder-founder-operating-loop/README.md) | The repeatable session rhythm for context, gates, decisions, evidence, and next actions |
| [Roadmap](../ROADMAP.md) | What is complete, what is next, and where adoption work continues |

## Five-Minute Narrative

1. AI agents need repository context before they touch code.
2. Maintainers need review context before they approve code.
3. Teams need merge gates before changes land on protected branches.
4. Companies need evidence after the fact: what changed, who reviewed it, what passed, and why it shipped.

repoctx handles the context side. PullPass handles the merge-safety side. The human decision remains visible instead of being hidden inside chat history or an admin merge.

## Evidence Inventory

| Evidence | Current state |
| --- | --- |
| repoctx identity and docs | Canonical `repoctx` name, public docs, maintainer attribution, and MCP workflow docs are published |
| MCP readiness | repoctx exposes repository inspection, maps, context packs, workspace reports, and PR review through an MCP server |
| Contributor readiness | Contributor docs, CODEOWNERS, security policy, templates, and maintainer review policy are in place |
| Release discipline | SemVer guidance, changelog discipline, CI, docs builds, and tagged release proof are documented |
| PullPass gate | PullPass supports local and PR review gates, governance modes, policy profiles, dependency-audit signals, and release checks |
| Review policy snapshot | repoctx and PullPass branch protection, CODEOWNERS, required checks, conversation-resolution, and admin-decision boundaries are summarized |
| Proof index | Public proof links and private evidence boundaries are mapped for company review |
| Bashbop pilot | API/mobile proof captured real auth, profile, R2 media, AI create-event, guided create-event, logout, and Android UI evidence |

## Evidence Hygiene

Company-facing proof must be useful without leaking private machine state.

- Public docs should link to GitHub URLs, release pages, PRs, screenshots, or repo-relative paths.
- Local absolute paths belong only in ignored internal artifacts such as `.dev-context/` or private operator notes.
- Evidence must not include secrets, tokens, cookies, raw credentials, customer data, private source code, or confidential repository output.
- Screenshots, terminal output, XML, JSON, and logs should be redacted before they become part of a public packet.

## Pilot Offer

Start with one repository and one real pull request.

| Week | Outcome | Evidence |
| --- | --- | --- |
| 1 | Install repoctx and PullPass | [Pilot runbook](./company-pilot-runbook.md), `repoctx doctor`, repo harness, PullPass local report |
| 2 | Add repoctx PR context to review | `.dev-context/pr-review.md` or a GitHub PR comment |
| 3 | Turn on review gates | Branch protection, CODEOWNERS, required checks, resolved conversations |
| 4 | Publish a proof run | Linked PR, CI result, PullPass verdict, human decision, release note |

The aim is not to slow teams down. The aim is to make the work easier to trust when agents, maintainers, and company policy all meet in the same repository.

After a reviewer reads this packet, run the first pilot with the [company pilot runbook](./company-pilot-runbook.md) and capture their response through the [company pilot feedback loop](./company-pilot-feedback.md). The feedback should produce a docs update, repoctx improvement, PullPass gate, proof artifact, pilot follow-up, or an explicit not-now decision.

Use the [builder-founder operating loop](../06-builder-founder-operating-loop/README.md) when the work spans multiple sessions. It keeps the handoff concrete: what context was gathered, what changed, what gate ran, who decided, and what remains.

## Governance Modes

| Mode | Merge expectation |
| --- | --- |
| Solo maintainer | Admin merge can be valid, but the owner decision must be recorded with CI and gate evidence |
| Small team | Require at least one reviewer and CODEOWNERS coverage for sensitive paths |
| Company team | Require CODEOWNERS, status checks, resolved conversations, and release evidence |
| High-risk team | Add stricter policies for auth, payments, data, deployment, secrets, and incident review |

PullPass is allowed to say `FAIL`. That is part of the value. A company should be able to see when a PR is not ready, why it is not ready, and what must change before merge.

## Readiness Checklist

A repository is ready for a company pilot when it has:

- A clear README and install path
- A repoctx context or harness artifact
- A PullPass local or PR gate report
- Branch protection and required status checks
- CODEOWNERS or an explicit owner policy
- A review policy snapshot or equivalent branch-protection record
- Contributor and security guidance
- A pilot runbook for the first real repository and PR
- A proof index that separates public artifacts from private operator evidence
- A dated proof run with sanitized evidence
- A visible human merge decision
- A public/private evidence boundary that keeps local paths and sensitive output out of company-facing docs

## Decision Record

Use this in a PR description, merge note, release note, or internal adoption memo:

```text
Trust-layer decision

Repository:
Change:
Risk area:

Context:
- repoctx artifact:
- PullPass mode:
- PullPass verdict:
- CI result:

Human decision:
- Owner or reviewer:
- Decision:
- Rationale:

Release evidence:
- Version:
- Changelog:
- Proof artifact:
```

## Bottom Line

The trust layer is not "AI writes code and the team hopes." It is:

```text
context before change
validation before merge
accountability before release
```

That is the shape a solo builder can use today and a company can adopt tomorrow.
