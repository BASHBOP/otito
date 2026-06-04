# repoctx-first workflow

This repository is the repoctx project. When Claude is working here, use repoctx as the first source of truth for repository context.

- Before planning or editing, run `repoctx context` for the task.
- If the scope is unclear or risk is elevated, run `repoctx impact` before changing files.
- If the work touches PR safety or merge readiness, run `repoctx pr` or `repoctx review` before giving a final answer.
- Prefer repoctx MCP tools over guessing file paths, routes, contracts, or review state from memory.
- Do not answer repo questions from memory when repoctx can inspect the repo directly.

## MCP

Use the built-in MCP server so Claude can call repoctx tools directly:

```bash
repoctx mcp
```

For Claude Desktop, Cursor, VS Code, and other MCP hosts, follow the host config examples in [docs/02-mcp-agent-workflows/README.md](docs/02-mcp-agent-workflows/README.md).

## Working Style

- Read the relevant source files after getting repoctx context.
- Keep changes scoped to the smallest owner files that actually need to move.
- Run the repo's validation commands before finishing a task.
- Preserve the trust-layer framing: context, tests, permissions, review, and durable evidence.
