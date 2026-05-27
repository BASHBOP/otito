# Contributing

Thanks for helping improve repoctx.

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

## Generated Artifacts

Generated repoctx reports and indexes belong under `.dev-context/`. That directory is ignored by git and by local formatting/linting config. Do not commit generated artifacts unless a maintainer explicitly asks for a fixture.

## Pull Request Checklist

- Keep changes scoped to the owning module and matching test.
- Update README, skill docs, or eval metadata when commands, package scripts, or MCP tools change.
- Add or update tests for behavior changes.
- Run `npm run ci`.
- Note any intentionally skipped checks in the pull request description.

## Coding Style

- Keep the CLI handlers thin; place behavior in `src/lib/*`.
- Prefer deterministic local data over model-generated assumptions.
- Return structured JSON from library functions and keep formatting separate.
- Preserve the legacy `dev-context` binary alias when changing command behavior.
