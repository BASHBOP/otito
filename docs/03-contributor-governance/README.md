# Contributor Governance

Òtítọ́ is a public MIT-licensed repository. Anyone can open an issue or pull request. Merge authority stays with human maintainers.

This page is the governance contract for `BASHBOP/otito`. Contributor workflow lives in [CONTRIBUTING.md](https://github.com/BASHBOP/otito/blob/main/CONTRIBUTING.md). Conduct lives in [CODE_OF_CONDUCT.md](https://github.com/BASHBOP/otito/blob/main/CODE_OF_CONDUCT.md). Release mechanics live in [Release Readiness](../04-release-readiness/README.md).

---

## Authorities

| Authority | Role |
| --- | --- |
| Contributors | Propose changes with evidence: tests, docs, and a focused diff |
| CODEOWNERS | Review the files they own; currently `* @BASHBOP/bashbop-team` |
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

This repository itself is a **team** repository: shared ownership, required review, and CODEOWNERS.

When Otito evaluates other repositories, the same product supports:

```bash
otito gate --pr "$PR_NUMBER" --path . --governance solo
otito gate --pr "$PR_NUMBER" --path . --governance team --policy company
```

Solo governance keeps one-person maintainer work moving while making missing separate review explicit `WARN` evidence. Team and company policies keep those gaps as blocking or high-severity evidence. Do not copy solo governance onto this repository.

---

## Review Path

1. Open an issue or draft PR for substantial work.
2. Run `npm run ci` on the change.
3. Request review from `@BASHBOP/bashbop-team`.
4. Address required checks and review comments.
5. A maintainer records the merge decision.

Security reports skip this public path. Use [SECURITY.md](https://github.com/BASHBOP/otito/blob/main/SECURITY.md).

---

## What Contributors Do Not Publish

Contributors do not cut Git tags, publish `@bashbop/otito` to npm, or publish `server.json` to the MCP Registry. Maintainers keep `package.json`, `package-lock.json`, `CHANGELOG.md`, the Git tag, and GitHub release notes aligned.

---

## Evidence Boundaries

- Keep generated artifacts under `.otito/` and out of commits.
- Sanitize issues and PR bodies: no secrets, private source, customer data, or local absolute paths.
- Editor-specific files such as `.cursor/` are not part of the published project tree.
