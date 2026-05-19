# Using dev-context With Local Ollama

This tutorial shows how to use `dev-context` as the repository-context layer for a local Ollama model.

`dev-context` does not run models. It creates compact repo artifacts that a local model can read:

- repo facts
- code maps
- setup and validation commands
- PR review context
- focused review prompts

Ollama provides the local model runtime.

## Prerequisites

Install dependencies for this repo:

```bash
npm install
```

Install Ollama and pull a model:

```bash
ollama pull qwen3:8b
```

Confirm the model is available:

```bash
ollama list
```

The examples below use `--think false --hidethinking --nowordwrap` so thinking-capable models keep command-line output concise and easier to review.

## Generate Repo Context

Start with the harness. It is the best first artifact to give a local model because it includes repo facts, commands, focus areas, and token estimates.

```bash
node src/cli.js harness . --out .dev-context/harness.md
```

Send it to Ollama:

```bash
{
  echo "Use this repo harness to explain the project, identify the main workflows, and suggest the next best engineering task."
  echo
  cat .dev-context/harness.md
} | ollama run qwen3:8b --think false --hidethinking --nowordwrap
```

## Ask For A Code Map Summary

For structure-oriented questions, generate the JSON code map:

```bash
node src/cli.js map . --json > .dev-context/map.json
```

Then ask Ollama to summarize the architecture:

```bash
{
  echo "Summarize this code map. Focus on domains, entrypoints, and files a new contributor should read first."
  echo
  cat .dev-context/map.json
} | ollama run qwen3:8b --think false --hidethinking --nowordwrap
```

## Review A Local PR

Generate PR context from the current branch:

```bash
node src/cli.js pr . --base origin/main --out .dev-context/pr-review.md
```

Then run a local review pass:

```bash
{
  echo "Review this PR context. Prioritize bugs, missing tests, risky behavior changes, and unclear rollout assumptions."
  echo
  cat .dev-context/pr-review.md
} | ollama run qwen3:8b --think false --hidethinking --nowordwrap
```

## Use JSON For Automation

Use JSON when another script or agent will consume the output:

```bash
node src/cli.js repo . --json > .dev-context/repo.json
node src/cli.js harness . --json > .dev-context/harness.json
node src/cli.js pr . --base origin/main --json > .dev-context/pr-review.json
```

Example:

```bash
{
  echo "Return a JSON array of the three highest-risk files to inspect next. Include path and reason only."
  echo
  cat .dev-context/pr-review.json
} | ollama run qwen3:8b --think false --hidethinking --nowordwrap
```

## MCP Boundary

Ollama is a local model runtime. It does not call MCP tools by itself.

To use `dev-context` through MCP with a local model, use an MCP-capable agent client that supports Ollama as its model provider. Configure the MCP server like this:

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

In that setup:

- Ollama answers model requests.
- The agent client calls MCP tools.
- `dev-context` returns repo context through MCP.

## Practical Prompt Pattern

Use direct instructions and include the generated artifact after the instruction:

```text
Task:
Review the provided dev-context artifact.

Focus:
- bugs
- missing tests
- risky behavior changes
- unclear commands or setup assumptions

Output:
- findings first
- then suggested verification commands
- keep the answer concise
```

This keeps local-model output grounded in the artifact instead of asking the model to infer repo state from memory.
