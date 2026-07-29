# Release Process

otito follows Semantic Versioning.

- Patch: bug fixes, docs corrections, low-risk test or CI improvements.
- Minor: new commands, new MCP tools, new report fields, or backward-compatible behavior.
- Major: removed commands, renamed fields, incompatible output changes, or changed runtime requirements.

Preserve this discipline across the stable 1.x line. Reserve the next major version for intentional CLI, MCP, cache, or runtime incompatibilities with an explicit migration guide.

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
10. Confirm npm Trusted Publishing is configured for `BASHBOP/otito` and `.github/workflows/release.yml`. The workflow uses GitHub OIDC (`id-token: write`) for provenance and does not require an `NPM_TOKEN` secret.
11. Confirm MCP Registry GitHub OIDC access is configured for `io.github.BASHBOP/otito`.
12. Push the tag. The `Release` workflow runs the full quality gate, publishes npm first, then creates the GitHub release and publishes `server.json` to the MCP Registry.
13. Verify the published binary:

```bash
npm install -g @bashbop/otito@1.0.2
otito doctor
```

## Compatibility Notes

The package exposes the `otito` binary. Release notes must call out any CLI output, JSON schema, MCP tool schema, generated workflow, cache format, Node.js engine, or package entrypoint changes.
