# repoctx - Executive Summary

**Purpose:** Context foundation for AI-assisted software teams<br>
**Maintainer:** Oluwasegun Olumbe<br>
**Current Version:** 0.3.1 trust-layer demo documentation

---

## Overview

repoctx answers one practical question:

```text
What should an agent or reviewer know before changing this repository?
```

It is a Node.js CLI and MCP server that produces deterministic, local-first repository context for coding agents, maintainers, and reviewers.

---

## What We Have Defined

| Area                  | Summary                                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------------------------- |
| Repository inspection | Files, package metadata, languages, package managers, scripts, entrypoints, and git state                      |
| Code maps             | JSON-first source maps with domains, imports, exports, symbols, and routes                                     |
| Context packs         | Task-aware file suggestions, related files, patterns, tests, and validation commands                           |
| Local catalog         | Discovery, indexing, and search across local repositories                                                      |
| PR review context     | Diff-aware review prompts, changed domains, risk flags, and optional GitHub comments                           |
| MCP support           | Agent-callable tools for repo inspection, maps, search, harnesses, workspaces, and PR review                   |
| Governance            | CI gates, CODEOWNERS, SemVer guidance, security reporting, contributor templates, and maintainer review policy |

---

## Product Position

repoctx is part of a larger trust layer:

```text
repoctx  -> context before change
PullPass -> validation before merge
Humans   -> accountability before release
```

This makes repoctx useful for maintainers who want AI-assisted development without losing the shape of the repository, test expectations, ownership boundaries, and review discipline.

---

## Gate Signals

| Signal                        | Current Handling                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------- |
| Unknown repository shape      | `repoctx repo` surfaces package, language, script, and git state                  |
| Unclear task scope            | `repoctx context` generates task-aware primary and related files                  |
| Multi-repo context missing    | `repoctx workspace` builds a product-level context report                         |
| PR review surface hidden      | `repoctx pr` summarizes changed files, risks, prompts, and comments               |
| Agent tool integration needed | `repoctx mcp` exposes repository context through MCP                              |
| Contributor readiness         | CI, CODEOWNERS, templates, security, release docs, and branch protection guidance |
| Trust-layer demo              | Public walkthrough for repoctx context, PR review context, PullPass, and human merge accountability |

---

## Critical Items Requiring Decision

| Priority | Item                 | Action Required                                                       |
| -------- | -------------------- | --------------------------------------------------------------------- |
| Medium   | Package distribution | Decide npm registry publication path or continue GitHub install first |
| Medium   | PullPass integration | Add direct links between repoctx PR context and PullPass reports      |
| Medium   | Demo assets          | Add screenshots or terminal captures for the repoctx + PullPass flow  |

---

## Next Steps

1. Add install examples for common agent hosts and MCP clients.
2. Link repoctx PR context output directly to PullPass reports.
3. Add terminal captures for the repoctx + PullPass trust-layer walkthrough.
4. Verify the flow on Bashbop-style API, web, and mobile repositories.
