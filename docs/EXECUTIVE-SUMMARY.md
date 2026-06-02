# repoctx - Executive Summary

**Purpose:** Context foundation for AI-assisted software teams<br>
**Maintainer:** Oluwasegun Olumbe<br>
**Current Version:** 1.3.1 — npm and MCP manifest versions are aligned; docs and MCP surface are current with multi-domain discoverability, eval + data-access subcommands, code maps for C#, Python, Java, Ruby, and Rust, and the v1.0 absorption (`impact`, `pass`, `pass-pr`, `review`)

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
| Code maps             | JSON-first source maps with multi-domain tagging, imports, exports, symbols, routes, and language extractors for TS/JS, Go, C#, Python, Java, Ruby, Rust |
| Context packs         | Task-aware file suggestions, related files, patterns, tests, validation commands, vendor-bundle filtering, and data-access boosts |
| Data-access surface   | Detects inline SQL and Prisma ORM calls, aggregated by source / operation / table / file                       |
| Eval suite            | `repoctx eval` measures token savings of repoctx output vs a deterministic naive-agent approximation           |
| Local catalog         | Discovery, indexing, and search across local repositories                                                      |
| PR review context     | Diff-aware review prompts, changed domains, risk flags, Go test-file detection, and optional GitHub comments   |
| MCP support           | Agent-callable tools for repo inspection, maps, search, harnesses, workspaces, and PR review                   |
| Governance            | CI gates, PullPass readiness, CODEOWNERS, SemVer guidance, security reporting, templates, and review policy    |
| Demo packet           | Company-facing packet that links the executive summary, case study, proof run, launch note, and pilot checklist |
| Pilot runbook         | Step-by-step first repository and pull request pilot with roles, evidence, stop conditions, and triage          |
| Proof index           | Sanitized public evidence map plus private/internal evidence boundaries for company reviewers                  |
| Review policy         | Branch protection, required checks, CODEOWNERS, conversation-resolution, and admin-decision snapshot           |
| Feedback loop         | Structured company pilot intake that turns reviewer concerns into docs, gates, proof, or roadmap work          |
| Company adoption      | Screenshot-style case study for evaluation, pilot rollout, and governance decision records                     |
| Public launch note    | Short external-facing story for repoctx, PullPass, proof runs, and next trust-layer gates                      |
| Operating loop        | Repeatable session rhythm for context, focused change, visible gates, human decisions, and durable evidence    |

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
| Context evidence disconnected | PullPass reports include repoctx `Context Evidence` commands for context packs and PR review reports |
| Agent tool integration needed | `repoctx mcp` exposes repository context through MCP                              |
| MCP setup unclear             | MCP workflow docs include generic stdio, Claude Desktop, VS Code, and Cursor examples |
| Contributor readiness         | CI, CODEOWNERS, templates, security, release docs, and branch protection guidance |
| Review policy visibility      | Review-policy snapshot summarizes branch protection and owner/admin decision boundaries |
| Trust-layer demo              | Public walkthrough for repoctx context, PR review context, PullPass, and human merge accountability |
| Session continuity            | Builder-founder operating loop keeps proof, gates, and next actions outside chat memory |

---

## Critical Items Requiring Decision

| Priority | Item                 | Action Required                                                       |
| -------- | -------------------- | --------------------------------------------------------------------- |
| Medium   | Package distribution | Decide npm registry publication path or continue GitHub install first |
| Medium   | Demo assets          | Keep dated proof runs, launch notes, and company adoption evidence current |
| Medium   | Company pilot        | Run the workflow with a real external reviewer and record feedback    |

---

## Next Steps

1. Keep the company adoption packet current as repoctx and PullPass evolve.
2. Run one real repository and pull request through the company pilot runbook.
3. Keep the proof index current as public artifacts and private proof boundaries evolve.
4. Capture feedback from real company reviewers through the pilot feedback loop and turn it into docs, gates, proof, or roadmap work.
5. Use the builder-founder operating loop for long-running sessions so context, gates, decisions, and next actions remain inspectable.
6. Keep MCP client examples current as Claude Desktop, VS Code, Cursor, and other hosts evolve.
