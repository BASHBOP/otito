# Release Process

repoctx follows SemVer.

- Patch: bug fixes, docs corrections, low-risk test or CI improvements.
- Minor: new commands, new MCP tools, new report fields, or backward-compatible behavior.
- Major: removed commands, renamed fields, incompatible output changes, or changed runtime requirements.

## Checklist

1. Confirm the worktree is clean.
2. Run `npm ci`.
3. Run `npm run ci`.
4. Update `CHANGELOG.md`.
5. Confirm `package.json` and `package-lock.json` have the intended version.
6. Tag the release as `vX.Y.Z`.
7. Publish from a clean checkout with `npm publish`.
8. Verify the installed binary:

```bash
npm install -g github:nugehs/repoctx
repoctx doctor
```

## Compatibility Notes

The package exposes both `repoctx` and the legacy `dev-context` binary. Release notes must call out any CLI output, JSON schema, MCP tool schema, generated workflow, or cache format changes.
