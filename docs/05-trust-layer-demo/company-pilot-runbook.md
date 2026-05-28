# Company Pilot Runbook

## Run the first real trust-layer pilot

Use this runbook when a company wants to test repoctx and PullPass on one repository and one real pull request. The goal is to prove the operating rhythm before expanding it across teams.

```text
repoctx  -> context before change
PullPass -> validation before merge
Humans   -> accountability before release
```

## Roles

| Role | Responsibility |
| --- | --- |
| Pilot owner | Chooses the repository, timeline, and success criteria |
| Repository maintainer | Confirms branch protection, CODEOWNERS, CI, and merge expectations |
| Reviewer | Uses repoctx output and PullPass signals during PR review |
| Governance reviewer | Checks evidence, policy fit, privacy, and audit needs |
| Tool operator | Runs repoctx, PullPass, and captures sanitized evidence |

For a solo-maintainer pilot, one person can hold several roles. The important part is that the decision is visible.

## Preflight

Before the pilot starts:

- Pick one non-critical repository and one focused change.
- Confirm CI is available, funded or enabled, and visible on pull requests.
- Confirm the base branch has branch protection or an explicit owner policy.
- Confirm CODEOWNERS exists for sensitive paths, or record why the pilot is using a solo-maintainer policy.
- Install repoctx and PullPass in the operator environment.
- Choose the governance mode: `solo`, `team`, `company`, or `high-risk`.
- Decide where private evidence will live, and what sanitized evidence can become public.

Do not include secrets, tokens, cookies, raw credentials, customer data, private source code, confidential repository output, or local absolute paths in public evidence.

## Pilot Steps

1. Open a pilot issue using the company pilot feedback form, or create an internal pilot issue with the same fields.
2. Run `repoctx doctor` and capture whether the local environment is ready.
3. Run `repoctx repo` to inspect repository shape, package metadata, scripts, and git state.
4. Run `repoctx harness` to record setup, validation, runtime, and context commands.
5. Generate task context before editing with `repoctx context`.
6. Make one focused change and open a pull request.
7. Generate PR review context with `repoctx pr`.
8. Run PullPass locally or against the PR with the selected governance mode.
9. Let the human reviewer or owner make the merge decision.
10. Record CI result, PullPass verdict, reviewer decision, and release evidence.
11. File feedback with one outcome label: `outcome:docs`, `outcome:repoctx`, `outcome:pullpass`, `outcome:proof`, `outcome:pilot`, or `outcome:not-now`.

## Evidence Table

| Artifact | Owner | Command or source | Pass signal |
| --- | --- | --- | --- |
| Environment check | Tool operator | `repoctx doctor` | Required tools are available or gaps are documented |
| Repository shape | Tool operator | `repoctx repo` | Scripts, language, package manager, and git state are understood |
| Harness | Repository maintainer | `repoctx harness` | Setup and validation commands are explicit |
| Task context | Reviewer | `repoctx context` | Primary files, related files, tests, and risks are visible before editing |
| PR context | Reviewer | `repoctx pr` | Diff, changed domains, prompts, and test hints are attached or summarized |
| Merge gate | Repository maintainer | PullPass local or PR report | Verdict is `PASS`, or `WARN`/`FAIL` is explained before merge |
| CI readiness | Repository maintainer | Pull request checks, Actions run, or CI dashboard | Jobs either ran to a clear result or the account/tooling blocker is recorded before merge |
| Review policy | Repository maintainer | [Review policy snapshot](./review-policy-snapshot.md) or target-repo branch settings | Branch protection, required checks, CODEOWNERS, and conversation resolution are understood |
| Human decision | Owner or reviewer | PR review, merge note, or decision record | Decision maker and rationale are visible |
| Release evidence | Pilot owner | Changelog, tag, release note, or proof run | Shipped behavior and validation are dated |
| Proof index | Governance reviewer | [Proof index](./proof-index.md) | Public artifacts and private evidence boundaries are clear |

## Decision Record

Use this in the PR description, merge note, release note, or internal adoption memo:

```text
Trust-layer pilot decision

Repository:
Pull request:
Governance mode:
Risk area:

repoctx evidence:
- Repository shape:
- Harness:
- Task context:
- PR context:

PullPass evidence:
- Mode:
- Policy:
- Verdict:
- Blockers or warnings:

Human decision:
- Owner or reviewer:
- Decision:
- Rationale:

Release evidence:
- CI result:
- CI blocker, if jobs did not start:
- Version or release note:
- Proof artifact:
```

## Success Criteria

A first pilot is successful when:

- One real repository and one real PR complete the workflow.
- repoctx context exists before review.
- PullPass verdict is captured before merge.
- CI status is visible.
- The human decision is visible.
- Public and private evidence are separated in the proof index.
- Evidence is sanitized before being shared publicly.
- The team can name the next improvement or decide not to continue.

## Stop Conditions

Pause the pilot if:

- The repository contains sensitive data that cannot be safely summarized.
- CI is missing, disabled, unfunded, or blocked by account/tooling configuration and the team cannot inspect behavior another way.
- Branch protection or owner policy is unclear for the base branch.
- PullPass reports a blocker the team cannot explain.
- The reviewer cannot identify who is accountable for the merge decision.
- Evidence includes secrets, private source, customer data, or local absolute paths.

If CI jobs do not start, record that separately from a failing test. A job that never runs is an environment or account-readiness blocker; it should keep PullPass in a non-passing state until the team fixes the CI setup, reruns the checks, or records an explicit owner decision with the risk accepted.

## Post-Pilot Triage

Every pilot should turn into one small next step:

| Outcome | Label | Next action |
| --- | --- | --- |
| Docs update | `outcome:docs` | Clarify installation, workflow, governance, or evidence guidance |
| repoctx improvement | `outcome:repoctx` | Improve context packs, maps, PR review output, or MCP tools |
| PullPass gate | `outcome:pullpass` | Add or tighten review, policy, CODEOWNERS, dependency, release, or branch checks |
| Proof artifact | `outcome:proof` | Add a dated proof run, screenshot, CI link, or release note |
| Pilot follow-up | `outcome:pilot` | Run the workflow on another repo or a higher-risk PR |
| Not now | `outcome:not-now` | Record why the use case is outside the current scope |

The first pilot does not need to prove every future policy. It needs to prove that AI-assisted work can leave a clean, reviewable evidence trail.
