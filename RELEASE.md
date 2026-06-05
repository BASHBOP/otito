# Release Process

repoctx follows Semantic Versioning.

- Patch: bug fixes, docs corrections, low-risk test or CI improvements.
- Minor: new commands, new MCP tools, new report fields, or backward-compatible behavior.
- Major: removed commands, renamed fields, incompatible output changes, or changed runtime requirements.

While repoctx is pre-1.0, preserve the same discipline: use patch releases for compatible fixes and minor releases for new or intentionally incompatible development milestones. Reserve `1.0.0` for the first stable CLI/MCP contract.

## Checklist

1. Confirm the worktree is clean.
2. Run `npm ci`.
3. Run `npm run ci`.
4. Choose the release type from merged PR version-impact notes: patch, minor, or major.
5. Update `CHANGELOG.md`.
6. Bump `package.json` and `package-lock.json` together with `npm version <patch|minor|major> --no-git-tag-version`.
7. Run `npm run version:check`.
8. Commit the release changes.
9. Tag the release as `vX.Y.Z` and push the tag.
10. Pushing the tag triggers the `Release` workflow, which runs the quality gate and publishes to npm with provenance. (Requires the `NPM_TOKEN` repository secret.)
11. Verify the installed binary:

```bash
npm install -g github:nugehs/repoctx
repoctx doctor
```

## Compatibility Notes

The package exposes both `repoctx` and the legacy `dev-context` binary. Release notes must call out any CLI output, JSON schema, MCP tool schema, generated workflow, cache format, Node.js engine, or package entrypoint changes.
