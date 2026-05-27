---
name: dev-context
description: Use when working with the repoctx repository, CLI, or MCP server; generating repository harnesses, repo maps, workspace reports, PR review context, route/client/domain lookup, token estimates, or installing/restoring repoctx from github.com/nugehs/repoctx.
---

# repoctx

Use `repoctx` to generate concrete repository context for agents and reviewers before editing, reviewing, or planning work. Prefer its structured output over guessing repo scripts, routes, file kinds, or cross-repo contracts.

The legacy `dev-context` command remains available as an alias.

## Source

The canonical skill source is backed by this repository at:

```bash
codex/skills/dev-context
```

If the repo is missing, restore it from:

```bash
git clone https://github.com/nugehs/repoctx /path/to/repoctx
```

If the installed skill is missing or stale, run this from a `repoctx` checkout:

```bash
codex/skills/dev-context/scripts/sync-installed.sh
```

## Quick Workflow

1. Start with the smallest context artifact that answers the task.
2. Use JSON output when another tool or script will consume it.
3. Use Markdown artifacts under `.dev-context/` when a human or long-running agent needs a durable report.
4. For cross-repo product work, use `workspace` instead of inspecting each repo in isolation.
5. For PR review, use `pr` with an explicit base when possible.
6. If `repoctx` is unavailable as a command, run `node /path/to/repoctx/src/cli.js ...`.

## CLI Commands

From the tool repo:

```bash
node src/cli.js help
node src/cli.js install
node src/cli.js i
node src/cli.js doctor
node src/cli.js repo /path/to/repo --json
node src/cli.js discover /path/to/workspace --depth 2 --json
node src/cli.js index /path/to/workspace --discover
node src/cli.js catalog --json
node src/cli.js search "events controller" --json
node src/cli.js context "add a new MCP tool" --path /path/to/repo --json
node src/cli.js map /path/to/repo --json
node src/cli.js harness /path/to/repo --out /path/to/repo/.dev-context/harness.md
node src/cli.js workspace /path/to/web /path/to/api --out .dev-context/workspace.md
node src/cli.js pr /path/to/repo --base origin/main --out /path/to/repo/.dev-context/pr-review.md
node src/cli.js report /path/to/repo --out /path/to/repo/.dev-context/report.md
node src/cli.js init /path/to/repo
node src/cli.js mcp
```

If installed as a package, the same commands can use `repoctx` instead of `node src/cli.js`.

Optional external tools:

```bash
npm install -g opensrc code-structure
```

Use these only when dependency-source lookup or TypeScript structure HTML is needed:

```bash
node src/cli.js deps zod --query parse --limit 20
node src/cli.js structure /path/to/repo --pattern "app/**/*.tsx" --out .dev-context/structure.html
```

## MCP Server

Run:

```bash
node /path/to/repoctx/src/cli.js mcp
```

MCP tools exposed by the server:

- `repo_inspect`: repository shape, scripts, package managers, entrypoints, git metadata
- `repo_map`: compact JSON code map with optional `domain` and `kind` filters
- `repo_discover`: local repository discovery under workspace roots
- `repo_index`: local `.dev-context/index.json` generation and catalog registration
- `repo_catalog`: local catalog listing
- `repo_search`: local catalog search across paths, domains, routes, imports, exports, and symbols
- `context_pack`: task-aware local context packet with primary files, related files, tests, patterns, validation commands, and source evidence
- `repo_harness`: setup, validation, runtime, and context commands
- `workspace_report`: product-level context across multiple repos
- `pr_review`: diff-aware PR review context and optional GitHub comment support
- `find_domain`: domain files across one or more repos
- `find_file_kind`: route, controller, service, component, hook, api client, DTO, schema, test, or source files
- `find_backend_route`: Nest controller route lookup
- `find_frontend_api_client`: frontend API client lookup by domain or query

## Interpretation Rules

- Treat generated context as a map, not proof. Confirm by reading the files before editing.
- Do not hardcode route, API-client, schema, or contract paths when `repoctx` can discover them.
- For dirty worktrees, report the state before writing generated artifacts.
- Use `.dev-context/` for generated reports in target repos; avoid mixing generated context into source directories.
- For PR review, lead with bugs, risky behavior changes, missing tests, and unclear contracts.

## Maintaining repoctx

When editing this repo, run:

```bash
npm run ci
npm test
npm run smoke
```

If CLI commands, MCP tools, or package scripts change, update this skill and its evals before syncing the installed copy.
