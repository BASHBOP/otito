# dev-context Proposal

## Decision

Build harnesses first, not a replacement for the existing tools.

The first useful product is an orchestration layer that gives developers and coding agents one reproducible interface for repo inspection, validation commands, dependency source lookup, structure reports, PR review context, and future sandbox execution.

## Why Wrapper First

- `opensrc` already solves dependency source lookup.
- `code-structure` already provides a baseline TypeScript structure visualization.
- Daytona already solves isolated execution and sandbox lifecycle.
- Harnss already explores the multi-agent desktop control surface.
- The missing piece is a practical glue layer that makes these capabilities easy to call, inspect, and pass to agents.

## Current MVP

This repository now contains a Node CLI for repo and agent harnesses:

```bash
node src/cli.js doctor
node src/cli.js repo . --json
node src/cli.js harness . --out .dev-context/harness.md
node src/cli.js matrix
node src/cli.js report . --out .dev-context/report.md
```

Optional integrations:

```bash
node src/cli.js deps zod --query parse
node src/cli.js structure . --out .dev-context/structure.html
```

Those require `opensrc` and `code-structure` to be installed.

## Build Later

Only build owned replacements after the wrapper exposes real pain:

- Replace `code-structure` if HTML-only output is too limited.
- Add a real code graph if symbol, dependency, or call navigation becomes the core value.
- Add Daytona when execution isolation is required.
- Add MCP/Harnss integration after CLI JSON contracts stabilize.
