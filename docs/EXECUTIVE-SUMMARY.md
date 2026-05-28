# repoctx - Executive Summary

**Purpose:** Context foundation for AI-assisted software teams<br>
**Maintainer:** Oluwasegun Olumbe<br>
**Current Version:** 0.3.2 Go-aware PR context

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
| Code maps             | JSON-first source maps with domains, imports, exports, symbols, routes, and Go source/test awareness           |
| Context packs         | Task-aware file suggestions, related files, patterns, tests, and validation commands                           |
| Local catalog         | Discovery, indexing, and search across local repositories                                                      |
| PR review context     | Diff-aware review prompts, changed domains, risk flags, Go test-file detection, and optional GitHub comments   |
| MCP support           | Agent-callable tools for repo inspection, maps, search, harnesses, workspaces, and PR review                   |
| Governance            | CI gates, PullPass readiness, CODEOWNERS, SemVer guidance, security reporting, templates, and review policy    |
| Demo packet           | Company-facing packet that links the executive summary, case study, proof run, launch note, and pilot checklist |
| Pilot runbook         | Step-by-step first repository and pull request pilot with roles, evidence, stop conditions, and triage          |
| Proof index           | Sanitized public evidence map plus private/internal evidence boundaries for company reviewers                  |
| Feedback loop         | Structured company pilot intake that turns reviewer concerns into docs, gates, proof, or roadmap work          |
| Company adoption      | Screenshot-style case study for evaluation, pilot rollout, and governance decision records                     |
| Public launch note    | Short external-facing story for repoctx, PullPass, proof runs, and next trust-layer gates                      |

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
| Merge readiness hidden        | PullPass PR readiness runs on pull requests and records owner-decision warnings   |
| Agent tool integration needed | `repoctx mcp` exposes repository context through MCP                              |
| Contributor readiness         | CI, CODEOWNERS, templates, security, release docs, and branch protection guidance |
| Trust-layer demo              | Public walkthrough for repoctx context, PR review context, PullPass, and human merge accountability |

---

## Critical Items Requiring Decision

| Priority | Item                 | Action Required                                                       |
| -------- | -------------------- | --------------------------------------------------------------------- |
| Medium   | Package distribution | Decide npm registry publication path or continue GitHub install first |
| Medium   | PullPass integration | Add direct links between repoctx PR context and PullPass reports      |
| Medium   | Demo assets          | Keep dated proof runs, launch notes, and company adoption evidence current |

---

## Next Steps

1. Add install examples for common agent hosts and MCP clients.
2. Link repoctx PR context output directly to PullPass reports.
3. Keep the company adoption packet current as repoctx and PullPass evolve.
4. Run one real repository and pull request through the company pilot runbook.
5. Keep the proof index current as public artifacts and private proof boundaries evolve.
6. Capture feedback from real company reviewers through the pilot feedback loop and turn it into docs, gates, proof, or roadmap work.
