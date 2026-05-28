# Review Policy Snapshot

## Branch protection and review evidence

Last verified: **May 28, 2026**

This snapshot summarizes the current review and branch protection posture for the public trust-layer repositories. It is written for company reviewers who need to know whether repoctx and PullPass are being developed behind visible gates.

Source: GitHub branch protection API for the `main` branches of `nugehs/repoctx` and `nugehs/pullpass`, plus the linked public PR and check evidence below. Raw API payloads stay out of public docs; this page keeps only the policy facts that matter for review.

## Repository Policies

| Policy signal | repoctx | PullPass |
| --- | --- | --- |
| Protected branch | `main` | `main` |
| Required status check | `Quality gates` | `Quality gates` |
| Strict status checks | Yes | Yes |
| Required approving reviews | 1 | 1 |
| CODEOWNERS review | Required | Required |
| Stale reviews dismissed | Yes | Yes |
| Last-push approval | Required | Not required |
| Conversation resolution | Required | Required |
| Force pushes | Disabled | Disabled |
| Branch deletion | Disabled | Disabled |
| Admin enforcement | Not enforced | Not enforced |

## Current Proof

| Proof | What it shows | Public link |
| --- | --- | --- |
| repoctx PullPass gate | repoctx now runs PullPass readiness inside CI | [repoctx PR #20](https://github.com/nugehs/repoctx/pull/20) |
| repoctx docs deployment | The docs site deployed from the protected `main` branch after the gate landed | [repoctx docs](https://nugehs.github.io/repoctx/) |
| PullPass context evidence | PullPass reports include repoctx context and PR review commands after a green gated merge | [PullPass PR #9](https://github.com/nugehs/pullpass/pull/9) |
| PullPass contributor intake | PullPass now has issue forms and a PR checklist for bugs, features, governance questions, release readiness, tests, PullPass output, and public-safe evidence | [PullPass PR #11](https://github.com/nugehs/pullpass/pull/11) |
| PullPass quality gates | PullPass `main` CI and docs deploy passed after the context-evidence and contributor-intake merges | [PullPass Actions](https://github.com/nugehs/pullpass/actions) |

## What This Proves

- The default branch is protected in both repositories.
- CI is a required merge signal, not optional background noise.
- CODEOWNERS and human approval are part of the merge contract.
- Unresolved review conversations block normal merge readiness.
- PullPass is being used to make merge readiness visible instead of relying on memory or chat history.
- repoctx and PullPass have a public evidence trail a company reviewer can inspect.

## What It Does Not Pretend

Admin enforcement is currently off. That means a repository admin can bypass the normal protected-branch path. In the current solo-maintainer stage, that is allowed only when the owner decision is explicit and supported by CI, PullPass, and release evidence.

For company pilots, the expectation changes:

| Mode | Review expectation |
| --- | --- |
| Solo maintainer | Owner/admin decision may be used, but it must be recorded with gate evidence |
| Team | Require a separate reviewer and CODEOWNERS approval before merge |
| Company | Require PR-mode evidence, required checks, resolved conversations, release evidence, and a visible approver |
| High-risk | Add stricter owner groups or specialist review for auth, data, payments, deployment, secrets, and incident-sensitive changes |

## Pilot Use

Use this page during a company pilot preflight:

1. Confirm the target repository has equivalent branch protection.
2. Confirm the required status checks are visible on pull requests.
3. Confirm CODEOWNERS covers sensitive paths.
4. Run repoctx before review so reviewers have repository context.
5. Run PullPass before merge so review, CI, CODEOWNERS, conversations, and policy state are visible.
6. Record whether the final decision was a reviewer approval or an explicit owner/admin decision.

The goal is simple: a company should be able to see why a change was allowed to merge.
