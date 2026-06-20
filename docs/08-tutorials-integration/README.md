# Tutorials Integration (Codespaces)

How to use repoctx alongside a tutorials/examples repo — such as
[`nugehs/tutorials`](https://github.com/nugehs/tutorials) — inside a GitHub Codespace. A
Codespace is the natural home for this pairing: the repo is already checked out, GitHub auth
is present, and repoctx runs entirely in-environment, so no code leaves the box.

The companion files for the **tutorials repo side** (a `.devcontainer/devcontainer.json` and
a ready-to-commit `repoctx.md` guide) are produced separately; this page documents the
integration from repoctx's perspective and is part of the repoctx docs site.

## Why Codespaces

repoctx is local-first and deterministic. In a Codespace that means:

- The agent works where the code lives (the AFK / away-from-keyboard pattern), and repoctx
  gives it deterministic context and a merge gate without a hosted code-search service.
- Everything is reproducible: the same `repoctx map` / `repoctx gate` output every run, so a
  learner and an agent see the same picture.
- Nothing is sent to a model to "understand" the repo — repoctx is static analysis.

## One-time setup

Add a devcontainer to the tutorials repo so every Codespace has repoctx ready:

```jsonc
// .devcontainer/devcontainer.json
{
  "name": "tutorials + repoctx",
  "image": "mcr.microsoft.com/devcontainers/universal:2-linux",
  "postCreateCommand": "REPOCTX_SKIP_POSTINSTALL=1 npm install -g @nugehs/repoctx && repoctx doctor"
}
```

`REPOCTX_SKIP_POSTINSTALL=1` suppresses repoctx's own post-install doctor so the check
prints exactly once, right after install. Without a devcontainer, install on demand with
`npm install -g @nugehs/repoctx`.

## Working a tutorial

All commands are path-based, so they make no assumptions about the tutorials' layout and can
be scoped to a single chapter folder:

| Goal | Command |
| --- | --- |
| Verify the environment | `repoctx doctor` |
| Map a chapter | `repoctx map ./03-async --json` |
| Context before a change | `repoctx context "add a test to the retry example" --path ./03-async` |
| Blast radius of a change | `repoctx impact "change the retry backoff" --path ./03-async` |
| Agent harness for the repo | `repoctx harness . --out .dev-context/harness.md` |
| Index for cross-tutorial search | `repoctx index . --discover` |
| Merge gate before committing | `repoctx gate . --base origin/main` |
| Agent-experience score | `repoctx ax "add a test to the retry example" --path ./03-async` |

The folder labels printed by `repoctx map . --json` are the values to pass to `--path` for
chapter-scoped runs.

## Wiring repoctx into the Codespace agent (MCP)

Commit a `.vscode/mcp.json` so any agent host in the Codespace can call repoctx tools:

```jsonc
// .vscode/mcp.json
{
  "servers": {
    "repoctx": { "command": "repoctx", "args": ["mcp"] }
  }
}
```

Pair it with a short `CLAUDE.md` / `AGENTS.md` at the tutorials repo root that tells agents
to run `repoctx context` before editing and `repoctx gate` before declaring a change
merge-ready — the same trust-layer discipline repoctx uses on itself.

## Related

- [MCP and Agent Workflows](../02-mcp-agent-workflows/README.md) — host config for Claude
  Desktop, Cursor, VS Code, and other MCP hosts.
- [Harness Thesis & Agent Experience](../07-harness-thesis/README.md) — why the harness
  (the Codespace + repoctx setup) matters more than the model.
