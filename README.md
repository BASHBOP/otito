# Òtítọ́

**Models generate the change. Otito proves whether it is safe to merge.**

[![CI](https://img.shields.io/github/actions/workflow/status/BASHBOP/otito/otito-ci.yml?style=flat-square&label=CI)](https://github.com/BASHBOP/otito/actions/workflows/otito-ci.yml) [![npm](https://img.shields.io/npm/v/@bashbop/otito?style=flat-square)](https://www.npmjs.com/package/@bashbop/otito) [![license: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE) [![node](https://img.shields.io/badge/node-%E2%89%A518.18-339933?style=flat-square)](https://nodejs.org/) [![Listed on mcpservers.org](https://mcpservers.org/badge.svg)](https://mcpservers.org/servers/bashbop/otito)

![otito demo](otito-demo.gif)

Otito is a local-first, deterministic, model-agnostic trust layer for AI-assisted development. It builds task-aware repository context before an agent edits, scores how much a change actually touches, and gates merge readiness against the exact staged tree — with no server, no account, and no code leaving the machine.

It does not replace Claude Code, Codex, Cursor, Gemini, or any native agent harness. It runs beside them and keeps working as the models change underneath.

A passing local gate is never an automatic merge approval: hosted CI, GitHub review, CODEOWNERS, and the human release decision remain separate authorities.

## Install

```bash
npm install -g @bashbop/otito
otito doctor
```

Or without installing: `npx -y @bashbop/otito doctor`.

## What it does

**Rank what a change actually touches**, from the request alone — no model, no embeddings, no network:

```console
$ otito impact . "add refund handling to checkout" --top 3

  concepts: money flow

   1.  src/payment/checkout.service.ts    score 155
       |- role: required
       |- path matches: checkout
       |- symbol matches: checkout, refund
       |- concept match: money flow (×1.4 + 6.0)
       |- risk: money flow

   2.  src/payment/stripe.webhook.ts    score 6
       |- role: advisory
       |- concept match: money flow (×1.4 + 6.0)
```

**Gate the exact staged tree**, and say precisely why:

```console
$ otito gate . --staged --base origin/main --request "add refund handling to checkout" --min-convergence 80

  [OK]    Changed files          1 changed file found.
  [OK]    Staged snapshot        Changed-file scope and convergence evidence are captured from the exact staged Git tree.
     |- Tree: 7d0b513dd256877d6bd309a6406468a9b1eaeedc
     |- Base: b776f04fcfbd02c8ce8d63e1a0c2450be58de039
  [OK]    Secret safety          No secret file paths and no credential values found in the changed content.
  [WARN]  Risk review            Risk-sensitive files changed; maintainer review should be explicit.
     |- src/payment/checkout.service.ts
  [OK]    Convergence            Task and diff satisfy the convergence requirement.
     |- Score: 100/100 (aligned)
     |- Receipt handle: rcpt_a8d31efae06e
     |- Subject tree: 7d0b513dd256877d6bd309a6406468a9b1eaeedc

  VERDICT  WARN
```

The convergence score is the part a model cannot grade for itself: it compares the stated intent against the files the diff actually changed, and produces a receipt bound to the exact base, parent, and staged-tree identity.

## Everyday commands

| Goal                               | Command                                                                     |
| ---------------------------------- | --------------------------------------------------------------------------- |
| Inspect one repo                   | `otito repo . --json`                                                       |
| Build a code map                   | `otito map . --json`                                                        |
| Prepare task context for an agent  | `otito context "add a new MCP tool" --path .`                               |
| Rank change blast radius           | `otito impact . "add refund handling" --top 12`                             |
| Score intent vs. execution         | `otito converge "add refunds" --path . --base HEAD --staged`                |
| Gate an exact staged change        | `otito gate . --staged --run-validation`                                    |
| Gate a product change across repos | `otito workspace-gate ../web ../api --request "ship change"`                |
| Review local changes               | `otito pr . --base origin/main --out .otito/pr-review.md`                   |
| Index and search local projects    | `otito index ~/projects --discover` then `otito search "events controller"` |
| Generate an agent harness          | `otito harness . --out .otito/harness.md`                                   |
| Run the MCP server                 | `otito mcp`                                                                 |
| Score Agent Experience             | `otito ax . "add a new MCP tool"`                                           |

Every command takes `--json`, and `otito help` lists the full set with flags.

## MCP

Otito ships a stdio MCP server exposing **13 tools** — `repo_inspect`, `repo_map`, `repo_index`, `repo_search`, `context_pack`, `change_impact`, `agent_experience`, `convergence_score`, `review_context`, `review_gate`, `review_verdict`, `workspace_report`, and `repo_harness`.

```json
{
  "mcpServers": {
    "otito": {
      "command": "npx",
      "args": ["-y", "@bashbop/otito", "mcp"]
    }
  }
}
```

Published in the MCP Registry as `io.github.BASHBOP/otito`. Repo-map lookups use an external per-user cache and never write into the inspected repository. Host-specific setup for Claude Code, Claude Desktop, Codex, Cursor, VS Code, Gemini CLI, and Kimi Code is in [MCP and Agent Workflows](https://bashbop.github.io/otito/02-mcp-agent-workflows/).

## How it compares

| Approach | Strengths | Where otito differs |
| --- | --- | --- |
| Sourcegraph / Cody context | Powerful hosted code search and embedding-based context across an org | Local-first and deterministic: no server, no account, no code leaves the machine, and the same query always yields the same packet |
| Hand-written `CLAUDE.md` / rules files | Curated, intent-rich guidance | Hand-written context goes stale; otito regenerates context from the actual code (symbols, imports, routes, tests) on every run and complements a short `CLAUDE.md` |
| `grep` / `ripgrep` | Fast, universal text matching | otito ranks whole files by task intent across paths, symbols, exports, and tests, then adds patterns and validation commands — a context packet, not a list of matching lines |

## Documentation

Full command reference, agent workflows, release process, evaluation method, and the design theses behind the trust layer:

**[bashbop.github.io/otito](https://bashbop.github.io/otito/)**

## Contributing

```bash
git clone https://github.com/BASHBOP/otito.git
cd otito && npm ci && npm run ci
```

`npm run ci` is the full gate: format, lint, typecheck, version check, tests, coverage floors (70% lines / 60% branches / 75% functions), three evaluation corpora, dependency audit, and a packaged-tarball smoke test. Run it before requesting review.

Start with [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). All changes need maintainer review; `main` requires passing gates and resolved conversations. Otito follows Semantic Versioning — say whether a PR is no-impact, patch, minor, or major.

---

## Part of the toolchain

**otito** is one of four tools that form a deterministic trust layer for AI-assisted development. Each uses static analysis to answer a question people keep handing to an LLM.

- **otito** (this tool), for context: what does this change actually touch?
- [tieline](https://www.npmjs.com/package/@bashbop/tieline), for contracts: did the front end and back end quietly stop agreeing?
- [bouncer](https://www.npmjs.com/package/@bashbop/bouncer), for compliance: could you defend this to Ofcom?
- [aiglare](https://www.npmjs.com/package/@bashbop/aiglare), for governance: where can the model do something you can't undo?

More at [segunolumbe.com](https://segunolumbe.com). _static analysis, never the model._
