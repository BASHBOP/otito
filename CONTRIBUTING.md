# Contributing to Òtítọ́

Thanks for helping improve Otito. This repository is public and MIT-licensed. Contributions are welcome as issues, discussions of design, and pull requests.

Please read the [Code of Conduct](CODE_OF_CONDUCT.md) before participating. Maintainer review, CODEOWNERS, and required checks are described in [Contributor Governance](docs/03-contributor-governance/README.md).

## Before You Start

1. Search [existing issues](https://github.com/BASHBOP/otito/issues) before opening a new one.
2. Open an issue or draft PR for substantial changes so maintainers can agree on scope.
3. Keep secrets, private source, customer data, and local absolute paths out of issues, logs, and generated artifacts.

Security issues are not public bug reports. Follow [SECURITY.md](SECURITY.md).

## Development Setup

```bash
git clone https://github.com/BASHBOP/otito.git
cd otito
npm ci
node src/cli.js doctor
```

Node.js 18.18 or newer is required. `npm ci` installs the lockfile exactly.

Optional: run Otito against this checkout before editing.

```bash
node src/cli.js context "your task" --path .
node src/cli.js impact "your task" --path .
```

Cursor users who want the local MCP server from this checkout can create `.cursor/mcp.json` (gitignored) with:

```json
{
  "mcpServers": {
    "otito": {
      "command": "npm",
      "args": ["run", "mcp", "--silent"],
      "env": {}
    }
  }
}
```

Do not commit editor-specific config under `.cursor/`. Host setup for published `otito mcp` is in [MCP and Agent Workflows](docs/02-mcp-agent-workflows/README.md).

## Making Changes

- Keep the diff focused on the requested change.
- Change the smallest owner files that already hold the behaviour. Do not add a helper, wrapper, or new layer unless the owner file cannot express the change.
- Leave unrelated cleanup, renaming, and formatting-only drive-bys out of the same PR. See the [clean code thesis](docs/16-clean-code-thesis/README.md).
- Register new CLI commands, handlers, and help output in the same change.
- Update README, skill docs, or eval metadata when commands, MCP tools, package scripts, schemas, or output shapes change.
- Keep generated reports under `.otito/`. Do not commit them.
- Do not add Cursor product artifacts, canvases, or `Co-authored-by: Cursor` trailers.

## Validation

Run the full quality gate before requesting review:

```bash
npm run ci
```

That runs format, lint, typecheck, version alignment, tests, coverage, evals, audit, and smoke checks. See the [Quality Gates](README.md#quality-gates) section in the README.

Focused tests are enough while iterating:

```bash
npm test
```

Docs changes should also pass a strict site build:

```bash
mkdocs build --strict
```

## Pull Requests

Use the pull request template. Identify version impact:

| Impact | When                                                                               |
| ------ | ---------------------------------------------------------------------------------- |
| None   | Docs, tests, CI, or internal-only change                                           |
| Patch  | Bug fix or low-risk internal improvement                                           |
| Minor  | New command, MCP tool, report field, or backward-compatible behavior               |
| Major  | Removed command, renamed field, incompatible output, or runtime requirement change |

Maintainers apply the package version during release. Do not bump `package.json` unless a maintainer asks you to.

A PR is ready for maintainer review when:

- `npm run ci` passes locally
- The Otito readiness check is green, or any `WARN`/`FAIL` is explained in the PR
- Generated `.otito/` artifacts are untracked
- Conversations are addressed

The protected `main` branch requires maintainer approval, passing required checks, and resolved conversations. A passing local gate is never an automatic merge.

## Governance For This Repository

This project uses team governance: code owners listed in `.github/CODEOWNERS` review changes, and humans remain the merge authority.

Release tagging, npm publish, and MCP Registry publish are maintainer tasks. See [Release Readiness](docs/04-release-readiness/README.md).

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
