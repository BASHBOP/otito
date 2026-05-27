# Contributing

Thanks for helping improve repoctx.

## Before You Start

- Open an issue or draft pull request for substantial behavior, CLI, MCP, generated-output, or workflow changes.
- Keep small fixes small. A focused pull request is easier to review and merge.
- Use `repoctx context "<task>" --path . --json` when you need a task-aware map before changing unfamiliar areas.

## Setup

```bash
npm ci
npm run doctor
```

Use Node.js 18.18 or newer.

## Quality Gates

Run the full local gate before opening a pull request:

```bash
npm run ci
```

That command checks formatting, lint rules, TypeScript compiler parsing for JavaScript modules, unit tests, coverage thresholds, production dependency audit, and the smoke harness.

For a smaller loop:

```bash
npm test
npm run smoke
```

## Version Impact

repoctx follows Semantic Versioning. Every pull request should declare its version impact in the PR template:

- None: docs, tests, CI, generated fixtures, or internal-only changes that do not affect users.
- Patch: bug fixes, docs corrections, dependency maintenance, or low-risk internal improvements.
- Minor: new commands, new MCP tools, new report fields, or backward-compatible behavior changes.
- Major: removed commands, renamed fields, incompatible output changes, or changed runtime requirements.

Contributors usually should not bump `package.json` in feature PRs unless a maintainer asks. Maintainers batch the final version bump during release and keep `package.json`, `package-lock.json`, `CHANGELOG.md`, and the release tag aligned.

## Review and Merge Policy

All code changes must go through a pull request. A maintainer/code owner must review and approve the PR before merge, and the required CI checks must pass.

Maintainers should not merge their own code without another maintainer review when another maintainer is available. For urgent solo-maintainer fixes, leave a clear note in the PR explaining the risk, validation run, and why the change could not wait.

The `main` branch is protected on GitHub to require:

- at least one approving review
- CODEOWNERS review for owned files
- passing quality gates
- resolved conversations before merge

## Generated Artifacts

Generated repoctx reports and indexes belong under `.dev-context/`. That directory is ignored by git and by local formatting/linting config. Do not commit generated artifacts unless a maintainer explicitly asks for a fixture.

## Pull Request Checklist

- Keep changes scoped to the owning module and matching test.
- Update README, skill docs, or eval metadata when commands, package scripts, or MCP tools change.
- Add or update tests for behavior changes.
- Run `npm run ci`.
- Note any intentionally skipped checks in the pull request description.
- Wait for maintainer/code-owner review before merge.

## Coding Style

- Keep the CLI handlers thin; place behavior in `src/lib/*`.
- Prefer deterministic local data over model-generated assumptions.
- Return structured JSON from library functions and keep formatting separate.
- Preserve the legacy `dev-context` binary alias when changing command behavior.
