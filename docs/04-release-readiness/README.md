# Release Readiness

repoctx follows Semantic Versioning and keeps releases tied to tests, changelog discipline, and maintainer review.

---

## Version Impact

| Impact | Examples                                                                                    |
| ------ | ------------------------------------------------------------------------------------------- |
| None   | Docs-only changes, tests, generated fixtures, CI-only adjustments                           |
| Patch  | Bug fixes, docs corrections, dependency maintenance, low-risk internal improvements         |
| Minor  | New commands, new MCP tools, new report fields, backward-compatible behavior                |
| Major  | Removed commands, renamed fields, incompatible output changes, changed runtime requirements |

---

## Release Gate

Before tagging a release:

```bash
npm run ci
npm run version:check
```

Maintainers should keep these aligned:

- `package.json`
- `package-lock.json`
- `CHANGELOG.md`
- Git tag
- GitHub release notes

---

## PullPass PR Readiness

repoctx runs PullPass on pull requests so merge-readiness evidence is visible before an owner or reviewer merges.

The workflow installs PullPass `v0.8.0` and runs:

```bash
pullpass pr "$PR_NUMBER" --repo . --governance solo
```

Solo governance keeps one-person maintainer work moving while making missing separate review or CODEOWNERS approval explicit `WARN` evidence. The owner/admin decision still has to be recorded before merge.

For a company or shared-team repository, switch the same workflow to:

```bash
pullpass pr "$PR_NUMBER" --repo . --governance team --policy company
```

Then require the `PullPass readiness` check alongside CI, docs build, required review, CODEOWNERS approval, and conversation resolution.

---

## Current Install Path

```bash
npm install -g github:nugehs/repoctx
repoctx doctor
```

The package also exposes the legacy alias:

```bash
dev-context doctor
```

---

## Trust-Layer Release Flow

```mermaid
flowchart TD
    A[repoctx context] --> B[Implementation]
    B --> C[npm run ci]
    C --> D[PR review]
    D --> E[PullPass gate]
    E --> F[Version and changelog]
    F --> G[Tag and GitHub release]
```
