# repoctx

`repoctx` is a local-first code context system. It discovers repositories, builds local indexes, maintains a catalog, searches code context, and generates lightweight harnesses for coding agents and reviewers.

The legacy `dev-context` command remains available as an alias.

It does not try to replace `opensrc`, `code-structure`, Daytona, or Harnss. It gives developers and coding agents a single CLI that can:

- inspect a repository
- discover and index local repositories
- maintain a local catalog and search across it
- check tool availability
- generate a setup/validation/runtime harness for a repo
- generate TypeScript structure HTML through `code-structure`
- search dependency source through `opensrc`
- produce Markdown or JSON reports
- generate AST-backed JSON-first code maps for agents
- estimate context-token size for generated artifacts
- generate actionable PR review context from git diffs and optional GitHub comments
- run an MCP server for agent hosts with a persisted repo index cache
- expose simple agent-friendly tool metadata

## Quick Start

This build uses the TypeScript parser for JS/TS code maps. Optional external tools are only needed for dependency-source lookup and HTML structure reports.

Install from GitHub:

```bash
npm install -g github:nugehs/dev-context
repoctx doctor
```

From a local checkout:

```bash
node src/cli.js install
npm install -g .
repoctx doctor
```

```bash
node src/cli.js help
node src/cli.js doctor
node src/cli.js init /path/to/target-repo
node src/cli.js repo . --json
node src/cli.js discover ~/projects --depth 2 --json
node src/cli.js index ~/projects --discover
node src/cli.js catalog
node src/cli.js search "events controller"
node src/cli.js map . --json
node src/cli.js harness . --out .dev-context/harness.md
node src/cli.js pr . --base origin/main --out .dev-context/pr-review.md
node src/cli.js mcp
node src/cli.js matrix
node src/cli.js report . --out .dev-context/report.md
node src/cli.js workspace /path/to/web /path/to/api --out .dev-context/workspace.md
```

Optional external tools:

```bash
npm install -g opensrc code-structure
```

Then:

```bash
node src/cli.js deps zod --query parse
node src/cli.js structure . --out .dev-context/structure.html
```

## Common Workflows

Agent repo harness:

```bash
node src/cli.js harness . --out .dev-context/harness.md
node src/cli.js map . --json
```

Local discovery, indexing, catalog, and search:

```bash
node src/cli.js discover ~/projects --depth 2
node src/cli.js index ~/projects --discover
node src/cli.js catalog
node src/cli.js search "submit rsvp"
```

PR review harness:

```bash
node src/cli.js pr . --base origin/main --out .dev-context/pr-review.md
node src/cli.js pr . --number 123 --comment
```

Multi-repo product context:

```bash
node src/cli.js workspace ../web ../api --out .dev-context/workspace.md
```

GitHub Actions bootstrap:

```bash
node src/cli.js init /path/to/target-repo
```

Local Ollama review:

```bash
node src/cli.js harness . --out .dev-context/harness.md

{
  echo "Use this repo harness to explain the project and suggest the next best engineering task."
  echo
  cat .dev-context/harness.md
} | ollama run qwen3:8b --think false --hidethinking --nowordwrap
```

Local Ollama PR review:

```bash
node src/cli.js pr . --base origin/main --out .dev-context/pr-review.md

{
  echo "Review this PR context. Focus on bugs, missing tests, and risky changes."
  echo
  cat .dev-context/pr-review.md
} | ollama run qwen3:8b --think false --hidethinking --nowordwrap
```

## Commands

### `doctor`

Checks the local runtime and optional external tools.

```bash
node src/cli.js doctor --json
```

### `install` / `i`

Prints install commands and current binary status. From a local checkout, `--global` runs `npm install -g .`; `--link` runs `npm link`.

```bash
node src/cli.js install
node src/cli.js i
node src/cli.js install --global
node src/cli.js install --json
```

After installation, use `repoctx` as the primary command. `dev-context` is kept as a legacy alias.

### `repo <path>`

Inspects repo shape: files, package metadata, languages, package managers, scripts, likely entrypoints, git metadata, and ignored-heavy directories.

```bash
node src/cli.js repo . --json
```

Git repositories are scanned through `git ls-files --cached --others --exclude-standard` so ignored files do not pollute harness context. Plain directories fall back to the built-in walker.

### `discover <root...>`

Discovers repository roots under one or more local directories without indexing them.

```bash
node src/cli.js discover ~/projects --depth 2
node src/cli.js discover . --json
```

Discovery stops at directories with common repo markers such as `package.json`, `.git`, `pyproject.toml`, `go.mod`, `Cargo.toml`, and `Package.swift`.

### `index <repo...>`

Generates local `.dev-context/index.json` files and adds repositories to the local catalog.

```bash
node src/cli.js index .
node src/cli.js index ~/projects --discover
node src/cli.js index . --catalog /tmp/dev-context-catalog.json --json
```

The default catalog path is `~/.dev-context/catalog.json`. Set `DEV_CONTEXT_CATALOG` or pass `--catalog` to use a different file.

### `catalog`

Lists repositories currently indexed in the local catalog.

```bash
node src/cli.js catalog
node src/cli.js catalog --json
```

### `search <query>`

Searches indexed local repositories by path, domain, kind, route, controller path, imports, exports, and symbols.

```bash
node src/cli.js search "events controller"
node src/cli.js search "submit rsvp" --limit 10
node src/cli.js search "api client" --offline --json
```

By default, search refreshes repo indexes when fingerprints change. Use `--offline` to read only the stored `.dev-context/index.json` files.

### `harness <path>`

Generates a repo harness with setup commands, validation scripts, runtime scripts, context commands, focus areas, and estimated context-token usage.

```bash
node src/cli.js harness . --out .dev-context/harness.md
node src/cli.js harness . --json
```

Use this as the first artifact an agent or CI workflow reads before touching code.

### `init <path>`

Scaffolds repoctx into another repository.

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
If it is not installed globally but `npx` is available, repoctx can run it through `npx --yes code-structure`.

### `deps <package>`

Uses `opensrc path <package>` to resolve dependency source and optionally search it.

```bash
node src/cli.js deps zod --query parse --limit 20
```

### `report <path>`

Generates a shareable developer report.

```bash
node src/cli.js report .
node src/cli.js report . --out .dev-context/report.md
node src/cli.js report . --json
```

The default output is formatted for terminal reading and ends with estimated token usage. Use `--out` for the Markdown artifact or `--json` for structured data.

### `workspace <repo...>`

Generates one product-level report across related repos.

```bash
node src/cli.js workspace /path/to/web /path/to/api --out .dev-context/workspace.md
node src/cli.js workspace /path/to/web /path/to/api --json
```

### `pr <path>`

Generates a PR review context pack from local git diff metadata, code-map classification, review targets, targeted review prompts, risk flags, suggested verification commands, estimated tokens, and optional GitHub PR comments.

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

Starts a stdio MCP server exposing repoctx as agent-callable tools. MCP repo-map lookups cache `.dev-context/index.json` with a file fingerprint and automatically refresh when files change.

```bash
node src/cli.js mcp
```

When wiring it into an MCP host, point the host at this repo's CLI:

```json
{
  "mcpServers": {
    "repoctx": {
      "command": "node",
      "args": ["/absolute/path/to/dev-context/src/cli.js", "mcp"]
    }
  }
}
```

Ollama can provide the local model, but it does not call MCP tools by itself. To use repoctx through MCP with a local model, use an MCP-capable agent client that supports Ollama as the model provider and configure the `repoctx` server above.

Useful tools exposed through MCP:

- `repo_inspect`
- `repo_map`
- `repo_harness`
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
