# otito-first workflow

This repository is the Otito project. When Codex is working here, use Otito as the first source of truth for repository context.

- Before planning or editing, run `node src/cli.js context` for the task.
- If the scope is unclear or risk is elevated, run `node src/cli.js impact` before changing files.
- If the work touches PR safety or merge readiness, run `node src/cli.js pr` or `node src/cli.js review` before giving a final answer.
- Prefer Otito MCP tools over guessing file paths, routes, contracts, or review state from memory.
- Do not answer repository questions from memory when Otito can inspect the repository directly.
- Keep durable generated evidence under `.otito/runs/YYYY-MM-DD/<task>/`. Do not write new artifacts under `.dev-context/`.

## MCP

Use the built-in MCP server so Codex can call Otito tools directly:

```bash
node src/cli.js mcp
```

For Codex Desktop, Cursor, VS Code, and other MCP hosts, follow the host config examples in [docs/02-mcp-agent-workflows/README.md](docs/02-mcp-agent-workflows/README.md).

## Working Style

- Read the relevant source files after getting Otito context.
- Keep changes scoped to the smallest owner files that actually need to move.
- Prefer existing patterns over a new abstraction. Clean code here means one purpose, a focused diff, and deterministic validation, not a cleaner agent.
- Run the repo's validation commands before finishing a task.
- Preserve the trust-layer framing: context, tests, permissions, review, and durable evidence.
