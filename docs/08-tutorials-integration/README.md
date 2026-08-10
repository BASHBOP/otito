# Tutorials Integration (Codespaces)

How to use otito alongside a tutorials/examples repo — such as
[`bashbop/tutorials`](https://github.com/BASHBOP/tutorials) — inside a GitHub Codespace. A
Codespace is the natural home for this pairing: the repo is already checked out, GitHub auth
is present, and otito runs entirely in-environment, so no code leaves the box.

The companion files for the **tutorials repo side** (a `.devcontainer/devcontainer.json` and
a ready-to-commit `otito.md` guide) are produced separately; this page documents the
integration from otito's perspective and is part of the otito docs site.

## Why Codespaces

otito is local-first and deterministic. In a Codespace that means:

- The agent works where the code lives (the AFK / away-from-keyboard pattern), and otito
  gives it deterministic context and a merge gate without a hosted code-search service.
- Everything is reproducible: the same `otito map` / `otito gate` output every run, so a
  learner and an agent see the same picture.
- Nothing is sent to a model to "understand" the repo — otito is static analysis.

## One-time setup

Add a devcontainer to the tutorials repo so every Codespace has otito ready:

```jsonc
// .devcontainer/devcontainer.json
{
  "name": "tutorials + otito",
  "image": "mcr.microsoft.com/devcontainers/universal:2-linux",
  "postCreateCommand": "git clone https://github.com/BASHBOP/otito.git \"$HOME/otito\" && cd \"$HOME/otito\" && npm ci && npm link && otito doctor"
}
```

The source checkout is used while npm publication is pending. Without a devcontainer, clone
Òtítọ́, run `npm ci`, then run `npm link` from that checkout.

## Working a tutorial

All commands are path-based, so they make no assumptions about the tutorials' layout and can
be scoped to a single chapter folder:

| Goal | Command |
| --- | --- |
| Verify the environment | `otito doctor` |
| Map a chapter | `otito map ./03-async --json` |
| Context before a change | `otito context "add a test to the retry example" --path ./03-async` |
| Blast radius of a change | `otito impact "change the retry backoff" --path ./03-async` |
| Agent harness for the repo | `otito harness . --out .otito/harness.md` |
| Index for cross-tutorial search | `otito index . --discover` |
| Merge gate before committing | `otito gate . --base origin/main` |
| Agent-experience score | `otito ax "add a test to the retry example" --path ./03-async` |

The folder labels printed by `otito map . --json` are the values to pass to `--path` for
chapter-scoped runs.

## Wiring otito into the Codespace agent (MCP)

Commit a `.vscode/mcp.json` so any agent host in the Codespace can call otito tools:

```jsonc
// .vscode/mcp.json
{
  "servers": {
    "otito": { "command": "otito", "args": ["mcp"] }
  }
}
```

Pair it with a short `CLAUDE.md` / `AGENTS.md` at the tutorials repo root that tells agents
to run `otito context` before editing and `otito gate` before declaring a change
merge-ready — the same trust-layer discipline otito uses on itself.

## Related

- [MCP and Agent Workflows](../02-mcp-agent-workflows/README.md) — host config for Claude
  Desktop, Cursor, VS Code, and other MCP hosts.
- [Harness Thesis & Agent Experience](../07-harness-thesis/README.md) — why the harness
  (the Codespace + otito setup) matters more than the model.
- [Determinism Thesis & Harness Boundary](../11-determinism-thesis/README.md) — why LLM
  output varies and what otito verifies instead.
- [Dual-Mode Thesis & Complementary Stack](../12-dual-mode-thesis/README.md) — probabilistic
  agents plus deterministic merge evidence.
- [Prompt Determinism Thesis & Settings Trap](../13-prompt-determinism-thesis/README.md) — why
  "tell it not to randomize" is not a merge gate.
