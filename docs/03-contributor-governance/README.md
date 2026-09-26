# Contributor Governance

Òtítọ́ is a public MIT-licensed repository. Anyone can open an issue or pull request. Merge authority stays with human maintainers.

This page is the governance contract for `BASHBOP/otito`. Contributor workflow lives in [CONTRIBUTING.md](https://github.com/BASHBOP/otito/blob/main/CONTRIBUTING.md). Conduct lives in [CODE_OF_CONDUCT.md](https://github.com/BASHBOP/otito/blob/main/CODE_OF_CONDUCT.md). Release mechanics live in [Release Readiness](../04-release-readiness/README.md).

---

## Authorities

| Authority | Role |
| --- | --- |
| Contributors | Propose changes with evidence: tests, docs, and a focused diff |
| CODEOWNERS | Review the files they own; currently `* @BASHBOP/bashbop-team`, whose only member is the maintainer |
| Required checks | Prove quality, docs, and merge readiness on the exact PR |
| Maintainers | Record the merge decision; they are not replaced by a local gate |
| Hosted CI | Independent of any agent or local `otito gate` result |

A passing Otito gate is evidence for the human decision. It is never automatic approval.

---

## Protected `main`

The default branch requires:

- Maintainer review before merge
- Resolved pull request conversations
- These GitHub status checks:
  - Quality gates (`npm run ci`)
  - Docs build (`mkdocs build --strict`)
  - Otito readiness (`node src/cli.js review`)

Otito readiness exits non-zero only on a blocking `FAIL`. A `WARN` must still be explained in the pull request.

---

## Governance Mode

This repository itself is a **solo** repository: one maintainer owns it, so no second person can approve the maintainer's own changes.

Otito defaults to team governance. The checked-in `.otitorc.json` sets `"governance": "solo"`, and every `otito` command run in this repository reads it, including the post-merge attestation. Solo governance keeps one-person maintainer work moving while making missing separate review explicit `WARN` evidence. On this repository's PR gate (`otito gate --pr`, `otito review --pr`):

- `Review decision` is `WARN`, not `FAIL`, when GitHub reports a required review that nobody has given. The maintainer records the owner/admin merge decision before merging.
- `CODEOWNERS` is `WARN`, not `FAIL`, when changed files have no code-owner approval.
- Requested changes still `FAIL`. No other check changes.

An explicit flag still overrides the file. Use it when a separate reviewer is required, or to see what team governance would block:

```bash
otito gate --pr "$PR_NUMBER" --path . --governance team
```

When Otito evaluates other repositories, the same product supports both modes:

```bash
otito gate --pr "$PR_NUMBER" --path . --governance solo
otito gate --pr "$PR_NUMBER" --path . --governance team --policy company
```

Team and company policies keep missing review and CODEOWNERS approval as blocking or high-severity evidence. Once a second maintainer can review, set `.otitorc.json` to `team`.

---

## Review Path

1. Open an issue or draft PR for substantial work.
2. Run `npm run ci` on the change.
3. Mark the PR ready for review; CODEOWNERS requests the maintainer's review.
4. Address required checks and review comments.
5. The maintainer records the merge decision.

Security reports skip this public path. Use [SECURITY.md](https://github.com/BASHBOP/otito/blob/main/SECURITY.md).

---

## What Contributors Do Not Publish

Contributors do not cut Git tags, publish `@bashbop/otito` to npm, or publish `server.json` to the MCP Registry. Maintainers keep `package.json`, `package-lock.json`, `CHANGELOG.md`, the Git tag, and GitHub release notes aligned.

---

## Evidence Boundaries

- Keep generated artifacts under `.otito/` and out of commits.
- Sanitize issues and PR bodies: no secrets, private source, customer data, or local absolute paths.
- Editor-specific files such as `.cursor/` are not part of the published project tree.
