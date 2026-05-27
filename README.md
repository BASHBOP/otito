# repoctx

`repoctx` is a local-first code context system. It discovers repositories, builds local indexes, maintains a catalog, searches code context, and generates lightweight harnesses for coding agents and reviewers.

The legacy `dev-context` command remains available as an alias.

It does not try to replace `opensrc`, `code-structure`, Daytona, or Harnss. It gives developers and coding agents a single CLI that can:

- inspect a repository
- discover and index local repositories
- maintain a local catalog and search across it
- generate task-aware context packets before an agent plans or edits
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
npm install -g github:nugehs/repoctx
repoctx doctor
```

From a local checkout:

```bash
node src/cli.js install
npm ci
npm run ci
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
node src/cli.js context "add a new MCP tool" --path .
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

## Usage Examples

| Goal | Command | Output |
| --- | --- | --- |
| Inspect one repo | `repoctx repo . --json` | Repo facts, scripts, languages, entrypoints, and git state |
| Build a code map | `repoctx map . --json` | Source files, domains, imports, exports, symbols, and routes |
| Prepare task context | `repoctx context "add a new MCP tool" --path .` | Primary files, related files, tests, patterns, and validation commands |
| Generate an agent harness | `repoctx harness . --out .dev-context/harness.md` | Setup, validation, runtime, and context commands |
| Review local changes | `repoctx pr . --base origin/main --out .dev-context/pr-review.md` | Changed files, risk prompts, review targets, and test hints |
| Index local projects | `repoctx index ~/projects --discover` | `.dev-context/index.json` files plus a local catalog |
| Search indexed repos | `repoctx search "events controller"` | Ranked matches across paths, domains, routes, imports, exports, and symbols |
| Run the MCP server | `repoctx mcp` | Stdio MCP server exposing repoctx tools |

## Quality Gates

Use the full gate before opening a pull request or publishing a release:

```bash
npm run ci
```

The gate runs:

- `npm run format:check`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run test:coverage`
- `npm run audit`
- `npm run smoke`

Coverage currently gates source files at 70% lines, 60% branches, and 75% functions. Generated artifacts under `.dev-context/` are ignored by git, linting, and formatting; keep durable reports there instead of committing them.

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

Task-aware agent context:

```bash
node src/cli.js context "add a new MCP tool" --path . --json
node src/cli.js context "add a new MCP tool" --path . --out .dev-context/context-pack.md
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
node src/cli.js index . --catalog /tmp/repoctx-catalog.json --json
```

The default catalog path is `~/.dev-context/catalog.json`. Set `REPOCTX_CATALOG`, the legacy `DEV_CONTEXT_CATALOG`, or pass `--catalog` to use a different file.

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

### `context <query>`

Generates a local context-engine packet for a task. The packet includes inferred intent, primary files, related files, matching tests, implementation patterns, validation commands, conflicts, source evidence, and token estimates.

```bash
node src/cli.js context "add a new MCP tool" --path . --json
node src/cli.js context "add a new CLI command" --path . --out .dev-context/context-pack.md
```

Use this before handing work to a coding agent. It is deterministic and local-first: it relies on repo indexes, code maps, import relationships, tests, and harness commands rather than an external model.

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
node src/cli.js init /path/to/target-repo --tool-repo nugehs/repoctx --tool-ref main
```

Generated files:

- `.dev-context/README.md`
- `.github/workflows/repoctx-ci.yml`

The generated workflow runs on pull requests and commit pushes. Pull request runs generate the report, upload an artifact, and create or update a sticky PR comment. Push runs generate and upload the report artifact without commenting.

### `structure <path>`

Runs `code-structure` against TypeScript files.

```bash
node src/cli.js structure . --pattern "app/**/*.tsx" --out .dev-context/structure.html
```

If `code-structure` is missing, the command returns an install hint instead of failing mysteriously. If it is not installed globally but `npx` is available, repoctx can run it through `npx --yes code-structure`.

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

This repo includes `.github/workflows/repoctx-ci.yml`. The workflow installs dependencies, runs `npm run ci`, then generates PR or push review context as an uploaded artifact. Use `node src/cli.js init /path/to/target-repo` to scaffold a repoctx review workflow into another repository.

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
      "args": ["/absolute/path/to/repoctx/src/cli.js", "mcp"]
    }
  }
}
```

Ollama can provide the local model, but it does not call MCP tools by itself. To use repoctx through MCP with a local model, use an MCP-capable agent client that supports Ollama as the model provider and configure the `repoctx` server above.

Useful tools exposed through MCP:

- `repo_inspect`
- `repo_map`
- `context_pack`
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
