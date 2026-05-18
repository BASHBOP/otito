# dev-context

`dev-context` is a thin wrapper for making existing developer-context tools work together.

It does not try to replace `opensrc`, `code-structure`, Daytona, or Harnss. The first version gives developers and coding agents a single CLI that can:

- inspect a repository
- check tool availability
- generate TypeScript structure HTML through `code-structure`
- search dependency source through `opensrc`
- produce Markdown or JSON reports
- generate JSON-first code maps for agents
- generate PR review context from git diffs and optional GitHub comments
- run a dependency-free MCP server for agent hosts
- expose simple agent-friendly tool metadata

## Quick Start

This build has no runtime npm dependencies.

```bash
node src/cli.js help
node src/cli.js doctor
node src/cli.js init /path/to/target-repo
node src/cli.js repo . --json
node src/cli.js map . --json
node src/cli.js pr . --base origin/main --out .dev-context/pr-review.md
node src/cli.js mcp
node src/cli.js matrix
node src/cli.js report . --out .dev-context/report.md
node src/cli.js workspace /path/to/web /path/to/api --out .dev-context/workspace.md
```

## Learning Guide

For a YouTube-friendly build plan with prompts, diagrams, milestones, and quality gates, see [docs/youtube-build-guide.md](docs/youtube-build-guide.md).

Optional external tools:

```bash
npm install -g opensrc code-structure
```

Then:

```bash
node src/cli.js deps zod --query parse
node src/cli.js structure . --out .dev-context/structure.html
```

## Commands

### `doctor`

Checks the local runtime and optional external tools.

```bash
node src/cli.js doctor --json
```

### `repo <path>`

Inspects repo shape: files, languages, package managers, scripts, likely entrypoints, git metadata, and ignored-heavy directories.

```bash
node src/cli.js repo . --json
```

### `init <path>`

Scaffolds `dev-context` into another repository.

```bash
node src/cli.js init /path/to/target-repo
node src/cli.js init /path/to/target-repo --force
node src/cli.js init /path/to/target-repo --no-workflow
node src/cli.js init /path/to/target-repo --tool-repo nugehs/dev-context --tool-ref main
```

Generated files:

- `.dev-context/README.md`
- `.github/workflows/dev-context-pr.yml`

The generated workflow runs on pull requests and commit pushes. Pull request runs generate the report, upload an artifact, and create or update a sticky PR comment. Push runs generate and upload the report artifact without commenting.

### `structure <path>`

Runs `code-structure` against TypeScript files.

```bash
node src/cli.js structure . --pattern "app/**/*.tsx" --out .dev-context/structure.html
```

If `code-structure` is missing, the command returns an install hint instead of failing mysteriously.
If it is not installed globally but `npx` is available, `dev-context` can run it through `npx --yes code-structure`.

### `deps <package>`

Uses `opensrc path <package>` to resolve dependency source and optionally search it.

```bash
node src/cli.js deps zod --query parse --limit 20
```

### `report <path>`

Generates a shareable developer report.

```bash
node src/cli.js report . --out .dev-context/report.md
node src/cli.js report . --json
```

### `workspace <repo...>`

Generates one product-level report across related repos.

```bash
node src/cli.js workspace /path/to/web /path/to/api --out .dev-context/workspace.md
node src/cli.js workspace /path/to/web /path/to/api --json
```

### `pr <path>`

Generates a PR review context pack from local git diff metadata, code-map classification, risk flags, suggested verification commands, and optional GitHub PR comments.

```bash
node src/cli.js pr . --base origin/main --out .dev-context/pr-review.md
node src/cli.js pr . --number 123 --comment
```

Useful flags:

- `--base <ref>`: compare from a specific base ref. Defaults to PR base, upstream, `origin/main`, or `main`.
- `--head <ref>`: compare to a specific head ref. Defaults to `HEAD`.
- `--number <n>`: enrich with `gh pr view` metadata and review comments.
- `--github`: ask `gh` to infer the PR from the current branch.
- `--comment`: create or update a sticky GitHub PR comment using `gh`.

### GitHub Actions

This repo includes `.github/workflows/dev-context-pr.yml`. Use `node src/cli.js init /path/to/target-repo` to scaffold the workflow into another repository.

### `mcp`

Starts a stdio MCP server exposing `dev-context` as agent-callable tools.

```bash
node src/cli.js mcp
```

When wiring it into an MCP host, point the host at this repo's CLI:

```json
{
  "mcpServers": {
    "dev-context": {
      "command": "node",
      "args": ["/absolute/path/to/dev-context/src/cli.js", "mcp"]
    }
  }
}
```

Useful tools exposed through MCP:

- `repo_inspect`
- `repo_map`
- `workspace_report`
- `pr_review`
- `find_domain`
- `find_file_kind`
- `find_backend_route`
- `find_frontend_api_client`

### `matrix`

Prints the tool evaluation matrix for Greploop, `code-structure`, `opensrc`, Daytona, and Harnss.

### `agent-tools`

Prints JSON metadata for agent integrations. This is intentionally lightweight so it can become an MCP server later without changing command semantics.

## Strategy

Wrap first. Measure pain. Build only the missing pieces.

This keeps the project useful quickly while leaving room to replace weak adapters with owned implementations later.
