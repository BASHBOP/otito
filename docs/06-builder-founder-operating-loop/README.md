# Builder-Founder Operating Loop

## Turn useful energy into repeatable evidence

Prepared by **Oluwasegun Olumbe**.

This page is the operating loop for Òtítọ́ and the wider trust-layer work. It is for Codex sessions, maintainers, contributors, and company reviewers who need the same rhythm to survive across branches, pull requests, releases, and pilots.

The point is simple:

```text
clear context
focused change
visible gate
human decision
durable evidence
```

Òtítọ́ provides both the context foundation and merge-safety gate. The maintainer turns that into a practice that can be repeated by one founder today and a company team tomorrow.

---

## Tool Boundaries

Òtítọ́ is the independent trust-harness surface. Its context, impact, and gate commands provide repository context, PR review context, workspace reports, agent-facing evidence, and merge readiness without competing with the coding agent's own loop.

`otito impact` is the canonical change-impact analyzer. Use it when scope is unclear, when import-neighbor evidence matters, or when a diff needs validation against the original change request. The standalone `impact-map` work has been absorbed into otito for normal product and agent workflows.

The rule is simple:

| Question | Use |
| --- | --- |
| What should an agent or reviewer know before changing this repo? | Òtítọ́ context |
| Is this PR ready to merge under the repo's governance rules? | Òtítọ́ gate |
| What files, import neighbors, tests, or missed diff areas might this change affect? | `otito impact` |

This keeps the public story clear: model-native agents generate changes; one model-agnostic product provides context and impact analysis before its final merge-safety evidence.

---

## Every Session Loop

Use this loop at the start of every meaningful coding-agent session.

| Step | Action | Evidence |
| --- | --- | --- |
| 1. Orient | Check git state, current branch, open PRs, and latest roadmap item | Clean or explained worktree, known base branch, no hidden conflict |
| 2. Map | Run otito context for the task and `otito impact` when scope or risk is unclear | Primary files, related files, tests, risks, and validation commands |
| 3. Choose | Pick one deliverable that moves the trust layer forward | A branch, issue, PR, docs page, release task, or proof artifact |
| 4. Change | Make the smallest complete change that satisfies the deliverable | Focused diff with no unrelated cleanup |
| 5. Prove | Run the relevant local checks and record any skipped checks | CI command output, docs build, Òtítọ́ result, or explicit no-test rationale |
| 6. Gate | Open or update a PR and let review gates speak before merge | CI, Òtítọ́ readiness, review state, CODEOWNERS state, conversations |
| 7. Decide | Record the owner or reviewer decision | PR review, merge note, release note, or trust-layer decision record |
| 8. Handoff | End with current state and next remaining goal | Clean worktree, PR link, check status, and next action |

This keeps sessions from becoming scattered. If a session cannot finish the whole objective, it should still leave one clearer artifact behind.

---

## Definition Of Ready

A trust-layer task is ready to start when these are known:

- The target repository and base branch.
- The user-facing goal or governance question.
- The expected risk level: docs, code, release, dependency, auth, data, deployment, or security-adjacent.
- The validation command or reason validation is not applicable.
- The review path: solo owner decision, maintainer review, team review, company review, or high-risk review.

If these are not known, the first deliverable is context: a otito report, `otito impact` output, issue note, or pilot preflight record.

## Definition Of Done

A trust-layer task is done only when the evidence matches the claim.

- The branch diff is focused and reviewed.
- Relevant tests, docs builds, audits, or smoke checks pass.
- Òtítọ́ gate result is captured when a merge decision is involved.
- Any `WARN` or `FAIL` state is explained before merge.
- Version impact is marked as none, patch, minor, or major.
- Public evidence avoids local absolute paths, secrets, customer data, private source, and confidential logs.
- The remaining plan is updated instead of being left in chat memory.

---

## Governance Ladder

| Mode | Use when | Merge bar |
| --- | --- | --- |
| Solo | One accountable maintainer owns the repo | Admin merge can be valid, but CI, Òtítọ́, and the owner decision must be visible |
| Small team | A small engineering team shares review | Require one human reviewer, required checks, and CODEOWNERS for sensitive paths |
| Company | A company evaluates or adopts the workflow | Require CODEOWNERS, status checks, resolved conversations, governance evidence, and release notes |
| High-risk | Auth, payments, data, deployment, secrets, or incident-prone code changes | Add stricter policy checks, explicit risk review, and stronger release or rollback evidence |

The same operating loop should work in every mode. The approval bar changes as the stakes rise.

---

## Evidence Ledger

Use this as the lightweight record for a PR, release, pilot, or company review.

```text
Trust-layer evidence

Repository:
Branch or PR:
Goal:
Risk mode:
Version impact:

Context:
- otito artifact:
- otito impact artifact:
- related repos:

Change:
- focused deliverable:
- changed domains:
- tests or docs touched:

Gate:
- CI:
- Gate mode:
- Gate verdict:
- reviewer or owner:
- CODEOWNERS:
- conversations:

Decision:
- merge decision:
- rationale:
- warnings accepted:

Release or proof:
- changelog or release note:
- tag or deploy:
- public proof:
- private evidence boundary:

Next:
- remaining blocker:
- next smallest action:
```

The ledger can live in a PR description, merge note, release note, company pilot issue, or proof run. The format matters less than the discipline: context, gate, decision, evidence.

---

## What To Track Across Sessions

| Track | Question | Artifact |
| --- | --- | --- |
| Product | Is otito still the independent context and merge-evidence layer? | README, docs, CLI/MCP behavior, tests |
| Gate | Is Òtítọ́ still the merge-safety signal? | Òtítọ́ workflow, local report, PR check, policy mode |
| Release | Can another maintainer understand what shipped? | SemVer impact, changelog, tag, GitHub release |
| Governance | Can a company see who was accountable? | CODEOWNERS, review policy, branch protection, decision record |
| Evidence | Can proof be shared safely? | Proof index, sanitized links, public/private boundary |
| Feedback | Did reviewer concerns become action? | Pilot feedback issue, outcome label, roadmap update |

When a session resumes, inspect these tracks before declaring the plan complete. A green check is useful evidence, but it is not the whole operating system.

---

## Next Best Action Rule

When the plan feels large, choose the next action in this order:

1. Fix a failing gate.
2. Close an open PR or conflict.
3. Add missing verification for an already shipped claim.
4. Tighten the company-facing evidence boundary.
5. Improve Òtítọ́ behavior that would make the next pilot easier.
6. Update roadmap, proof index, or release notes so the current state is not trapped in memory.

This keeps the builder-founder path practical: build, prove, publish, review, repeat.
