# Company Pilot Feedback

## Turn reviewer questions into product work

The company demo packet is only useful if feedback becomes action. This page defines the intake loop for engineering leaders, platform teams, developer-experience owners, security reviewers, and AI governance reviewers evaluating repoctx and PullPass.

The goal is to capture three things:

- What companies trust already
- What blocks a first pilot
- What should become docs, repoctx behavior, PullPass policy, or release evidence

## Feedback Intake

Open a **Company pilot feedback** issue after a reviewer has read the [company demo packet](./company-demo-packet.md) or completed the [company pilot runbook](./company-pilot-runbook.md). New issues from that form are labeled `pilot-feedback`, `trust-layer`, and `enhancement` automatically.

If the reviewer already knows the first target, name the repository and pull request in the issue. That makes the pilot easier to track and turns the feedback into something the next session can act on directly.

Good feedback is structured and sanitized:

- No secrets
- No customer data
- No private source code
- No tokens, cookies, or credentials
- No confidential repository output
- No local absolute paths from a reviewer's machine
- Clear role, repository type, governance mode, blockers, and readiness score

Use public links, repo-relative paths, or short summaries when referencing evidence. Keep raw logs, generated context folders, and machine-specific paths in private internal notes unless they have been sanitized for sharing.

## Review Scorecard

Use this scorecard when reviewing company feedback.

| Area | Question | Possible follow-up |
| --- | --- | --- |
| Install path | Can a team install repoctx and PullPass without help? | Improve install docs or add host-specific setup notes |
| MCP readiness | Can an agent host connect to repoctx cleanly? | Add MCP client examples or troubleshooting |
| Review context | Does repoctx expose the files, tests, risk, and prompts reviewers need? | Improve context ranking or PR review output |
| Merge gate | Does PullPass make review, CODEOWNERS, CI, conversations, and policy state clear? | Add policy checks or clearer verdict language |
| Governance | Does the team understand solo, small-team, company, and high-risk modes? | Add examples and decision records |
| Evidence | Is the proof run strong enough for audit, incident review, or security review? | Add screenshots, dated proof runs, retention guidance, or proof-index links |
| Pilot shape | Can the reviewer name one repo and one PR to try first? | Narrow the pilot plan or use the pilot runbook |

## Triage Rule

Every feedback issue should produce one of these outcomes:

| Outcome | Label | Use when |
| --- | --- | --- |
| Docs update | `outcome:docs` | The workflow exists, but the explanation is unclear |
| repoctx improvement | `outcome:repoctx` | Context, ranking, maps, MCP tools, or PR review output are missing useful information |
| PullPass gate | `outcome:pullpass` | Review, policy, CODEOWNERS, dependency, release, or branch-protection behavior needs a stronger signal |
| Proof artifact | `outcome:proof` | The reviewer needs stronger dated evidence before trusting adoption |
| Pilot follow-up | `outcome:pilot` | The reviewer is ready to test the flow on one repository |
| Not now | `outcome:not-now` | The use case is outside the trust-layer scope for the current phase |

## Weekly Builder-Founder Rhythm

Use this loop while the project is moving from founder-led proof into company adoption:

1. Send the company demo packet.
2. Run the first repo and PR pilot with the company pilot runbook.
3. Capture structured feedback as an issue.
4. Label the issue by outcome: `outcome:docs`, `outcome:repoctx`, `outcome:pullpass`, `outcome:proof`, `outcome:pilot`, or `outcome:not-now`.
5. Convert the highest-signal issue into one small PR.
6. Run repoctx context before editing.
7. Run PullPass before merge where a PR exists.
8. Update release notes or proof artifacts when behavior changes.

This keeps the work from becoming a pile of opinions. Feedback becomes a queue of small, reviewable improvements.

## Pilot Success Criteria

A first company pilot is successful when:

- One real repository is selected
- One real pull request goes through the workflow
- repoctx context or PR review output is attached
- PullPass verdict is recorded
- CI status is visible
- The human decision is visible
- A reviewer can name what they would change before wider rollout

The first pilot does not need to be perfect. It needs to prove that AI-assisted work can leave a clean evidence trail.
