# Proof Index

## Sanitized evidence map

This index shows what a company reviewer can inspect without receiving private machine paths, raw internal logs, credentials, customer data, or source code that is not already public.

Use it with the [company demo packet](./company-demo-packet.md) and [company pilot runbook](./company-pilot-runbook.md).

## Public Proof

| Proof | What it shows | Public artifact |
| --- | --- | --- |
| repoctx documentation | Context foundation, install path, MCP workflows, contributor governance, and release readiness | [repoctx docs](https://nugehs.github.io/repoctx/) |
| PullPass documentation | Merge gate behavior, governance modes, policy profiles, dependency-audit signals, and PR checks | [PullPass docs](https://nugehs.github.io/pullpass/) |
| repoctx release proof | SemVer release discipline and published package state | [repoctx v0.3.2](https://github.com/nugehs/repoctx/releases/tag/v0.3.2) |
| PullPass release proof | Company and high-risk policy profiles plus dependency-audit signals | [PullPass v0.8.0](https://github.com/nugehs/pullpass/releases/tag/v0.8.0) |
| PullPass context evidence | PullPass reports now include repoctx context and PR review commands as review evidence | [PullPass PR #9](https://github.com/nugehs/pullpass/pull/9) |
| PullPass contributor intake | Issue forms and PR checklist capture bugs, features, governance questions, release readiness, tests, PullPass output, and public-safe evidence | [PullPass PR #11](https://github.com/nugehs/pullpass/pull/11) |
| Trust-layer proof run | End-to-end repoctx context, PullPass gate, CI, owner decision, and release evidence | [Proof run 2026-05-28](./proof-run-2026-05-28.md) |
| Company adoption case study | Screenshot-style explanation for engineering leaders and governance reviewers | [Company adoption case study](./company-adoption-case-study.md) |
| Company demo packet | Short sendable packet that ties the proof, runbook, feedback loop, and roadmap together | [Company demo packet](./company-demo-packet.md) |
| Company pilot runbook | Step-by-step first repository and pull request pilot | [Company pilot runbook](./company-pilot-runbook.md) |
| Review policy snapshot | Branch protection, required checks, CODEOWNERS, conversation-resolution, and admin-decision boundaries | [Review policy snapshot](./review-policy-snapshot.md) |
| Company pilot feedback loop | Structured intake that turns reviewer concerns into docs, gates, proof, or roadmap work | [Company pilot feedback](./company-pilot-feedback.md) |

## Private Or Internal Proof

Some evidence is useful for operators but should not be copied into public docs.

| Internal proof | Why it stays private | Public substitute |
| --- | --- | --- |
| Generated `.dev-context/` folders | May contain local repository paths, raw command output, UI XML, or logs | Summarize results with repo-relative paths or public links |
| Raw Bashbop API/mobile proof output | May include local runtime details, disposable account traces, screenshots, or backend response shapes | Use a sanitized dated summary and only publish redacted screenshots when needed |
| Local environment notes | May reveal machine-specific setup or private tooling state | Publish generic install steps and validation commands |
| Raw GitHub API payloads | May include fields that are irrelevant to reviewers or unsafe to retain broadly | Link to PRs, checks, releases, or summarized PullPass verdicts |

## Acceptance Rules

A proof artifact is company-ready when it has:

- A date, version, PR, release, or check run that identifies the evidence.
- A clear owner decision when review or admin merge matters.
- Validation commands or CI checks that match the risk of the change.
- Branch protection and review policy evidence for the base branch.
- PullPass verdicts with `WARN` and `FAIL` states explained, not hidden.
- Public links, repo-relative paths, or redacted screenshots instead of local absolute paths.
- No secrets, tokens, cookies, raw credentials, customer data, private source code, or confidential output.

## Pilot Usage

Start public. Share this proof index, the company demo packet, the pilot runbook, and the relevant release or PR links.

If a reviewer needs deeper evidence, provide a sanitized extract rather than raw internal folders. The goal is a clean evidence trail that a company can trust without inheriting private operator state.
