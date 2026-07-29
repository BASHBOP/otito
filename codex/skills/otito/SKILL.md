---
name: otito
description: Use when working with the otito repository, CLI, or MCP server; generating repository harnesses, repo maps, workspace reports, PR review context, route/client/domain lookup, token estimates, or installing/restoring otito from github.com/BASHBOP/otito.
---

# otito

Use `otito` to generate concrete repository context for agents and reviewers before editing, reviewing, or planning work. Prefer its structured output over guessing repo scripts, routes, file kinds, or cross-repo contracts.

## Source

The canonical skill source is backed by this repository at:

```bash
codex/skills/otito
```

If the repo is missing, restore it from:

```bash
git clone https://github.com/BASHBOP/otito /path/to/otito
```

If the installed skill is missing or stale, run this from a `otito` checkout:

```bash
codex/skills/otito/scripts/sync-installed.sh
```

## Quick Workflow

1. Start with the smallest context artifact that answers the task.
2. Use JSON output when another tool or script will consume it.
3. Use Markdown artifacts under `.otito/` when a human or long-running agent needs a durable report.
4. For cross-repo product work, use `workspace` instead of inspecting each repo in isolation.
5. For PR review, use `pr` with an explicit base when possible.
6. If `otito` is unavailable as a command, run `node /path/to/otito/src/cli.js ...`.

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
node src/cli.js harness /path/to/repo --out /path/to/repo/.otito/harness.md
node src/cli.js workspace /path/to/web /path/to/api --out .otito/workspace.md
node src/cli.js pr /path/to/repo --base origin/main --out /path/to/repo/.otito/pr-review.md
node src/cli.js report /path/to/repo --out /path/to/repo/.otito/report.md
node src/cli.js init /path/to/repo
node src/cli.js mcp
```

If installed as a package, the same commands can use `otito` instead of `node src/cli.js`.

Optional external tools:

```bash
npm install -g opensrc code-structure
```

Use these only when dependency-source lookup or TypeScript structure HTML is needed:

```bash
node src/cli.js deps zod --query parse --limit 20
node src/cli.js structure /path/to/repo --pattern "app/**/*.tsx" --out .otito/structure.html
```

## MCP Server

Run:

```bash
node /path/to/otito/src/cli.js mcp
```

MCP tools exposed by the server:

- `repo_inspect`: repository shape, scripts, package managers, entrypoints, git metadata
- `repo_map`: compact JSON code map with optional `domain`, `kind`, and `route` filters
- `repo_index`: local `.otito/index.json` generation and catalog registration; `dryRun:true` discovers read-only
- `repo_search`: local catalog search across paths, domains, routes, imports, exports, and symbols; omit `query` to list the catalog
- `context_pack`: task-aware local context packet with primary files, related files, tests, patterns, validation commands, and source evidence
- `change_impact`: rank files most likely to own a plain-English change request
- `agent_experience`: Agent Experience (AX 0–100) score for a change
- `convergence_score`: intent vs. execution score (0–100) with a recomputable receipt
- `review_context`: diff-aware PR review context (no verdict)
- `review_gate`: PASS/WARN/FAIL merge gate — local without `pr`, GitHub PR gate with `pr`
- `review_verdict`: composite verdict (impact + review context + gate)
- `workspace_report`: product-level context across multiple repos
- `repo_harness`: setup, validation, runtime, and context commands

## Interpretation Rules

- Treat generated context as a map, not proof. Confirm by reading the files before editing.
- Do not hardcode route, API-client, schema, or contract paths when `otito` can discover them.
- For dirty worktrees, report the state before writing generated artifacts.
- Use `.otito/` for generated reports in target repos; avoid mixing generated context into source directories.
- For PR review, lead with bugs, risky behavior changes, missing tests, and unclear contracts.

## Maintaining otito

When editing this repo, run:

```bash
npm run ci
npm test
npm run smoke
```

If CLI commands, MCP tools, or package scripts change, update this skill and its evals before syncing the installed copy.
