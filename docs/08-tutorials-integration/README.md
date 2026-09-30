# Tutorials Integration (Codespaces)

How to use solumbe alongside a tutorials/examples repo, such as
[`bashbop/tutorials`](https://github.com/BASHBOP/tutorials), inside a GitHub Codespace. A
Codespace is the natural home for this pairing: the repo is already checked out, GitHub auth
is present, and solumbe runs entirely in-environment, so no code leaves the box.

The companion files for the **tutorials repo side** (a `.devcontainer/devcontainer.json` and
a ready-to-commit `solumbe.md` guide) are produced separately; this page documents the
integration from solumbe's perspective and is part of the solumbe docs site.

## Why Codespaces

solumbe is local-first and deterministic. In a Codespace that means:

- The agent works where the code lives (the AFK / away-from-keyboard pattern), and solumbe
  gives it deterministic context and a merge gate without a hosted code-search service.
- Everything is reproducible: the same `solumbe map` / `solumbe gate` output every run, so a
  learner and an agent see the same picture.
- Nothing is sent to a model to "understand" the repo, because solumbe is static analysis.

## One-time setup

Add a devcontainer to the tutorials repo so every Codespace has solumbe ready:

```jsonc
// .devcontainer/devcontainer.json
{
  "name": "tutorials + solumbe",
  "image": "mcr.microsoft.com/devcontainers/universal:2-linux",
  "postCreateCommand": "git clone https://github.com/BASHBOP/solumbe.git \"$HOME/solumbe\" && cd \"$HOME/solumbe\" && npm ci && npm link && solumbe doctor"
}
```

The source checkout is used while npm publication is pending. Without a devcontainer, clone
Solumbe, run `npm ci`, then run `npm link` from that checkout.

## Working a tutorial

All commands are path-based, so they make no assumptions about the tutorials' layout and can
be scoped to a single chapter folder:

| Goal | Command |
| --- | --- |
| Verify the environment | `solumbe doctor` |
| Map a chapter | `solumbe map ./03-async --json` |
| Context before a change | `solumbe context "add a test to the retry example" --path ./03-async` |
| Blast radius of a change | `solumbe impact "change the retry backoff" --path ./03-async` |
| Agent harness for the repo | `solumbe harness . --out .solumbe/harness.md` |
| Index for cross-tutorial search | `solumbe index . --discover` |
| Merge gate before committing | `solumbe gate . --base origin/main` |
| Agent-experience score | `solumbe ax "add a test to the retry example" --path ./03-async` |

The folder labels printed by `solumbe map . --json` are the values to pass to `--path` for
chapter-scoped runs.

## Wiring solumbe into the Codespace agent (MCP)

Commit a `.vscode/mcp.json` so any agent host in the Codespace can call solumbe tools:

```jsonc
// .vscode/mcp.json
{
  "servers": {
    "solumbe": { "command": "solumbe", "args": ["mcp"] }
  }
}
```

Pair it with a short `CLAUDE.md` / `AGENTS.md` at the tutorials repo root that tells agents
to run `solumbe context` before editing and `solumbe gate` before declaring a change
merge-ready, using the same trust-layer discipline solumbe uses on itself.

## Related

- [MCP and Agent Workflows](../02-mcp-agent-workflows/README.md): host config for Claude
  Desktop, Cursor, VS Code, and other MCP hosts.
- [Harness Thesis & Agent Experience](../07-deterministic-verification/README.md): why the harness
  (the Codespace + solumbe setup) matters more than the model.
- [Deterministic Verification](../07-deterministic-verification/README.md): why LLM
  output varies and what solumbe verifies instead.
- [Deterministic Verification](../07-deterministic-verification/README.md): probabilistic
  agents plus deterministic merge evidence.
- [Deterministic Verification](../07-deterministic-verification/README.md): why
  "tell it not to randomize" is not a merge gate.
- [Deterministic Verification](../07-deterministic-verification/README.md): why independent
  merge evidence outlasts generic agent orchestration.
