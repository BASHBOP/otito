# :material-source-branch: Òtítọ́

## Independent trust infrastructure for agents and reviewers

> For teams that want any coding agent to produce evidence a human can trust before merge.

**v1.14.0** is published to npm, GitHub Releases, and the official MCP Registry. Òtítọ́ is a Bashbop Ltd product, MIT licensed.

---

!!! info "About Òtítọ́"
    Òtítọ́ is a local-first trust harness for coding agents. It maps repository context before a change, then produces deterministic impact, validation, ownership, and review evidence before merge. It complements model-native agent loops instead of replacing them.

    Its command-line and package identity is `otito`.

    :material-animation-play: See the [**How It Works** visual walkthrough](assets/otito-how-it-works.html), a layered diagram of the discover → index → context → gate flow.

---

## What's New

!!! tip "v1.14.0 published (2026-09-20)"
    - A `UserPromptSubmit` hook routes **every** request before any work starts, not only the ones a skill remembers to route. It advises the session and binds the model on delegated subagents; it cannot switch the session's own model, and says so.
    - Markdown is now indexed, so skills and docs pages can be found. A request naming a skill used to rank unrelated library files; it now ranks the skill first.
    - Fixed: a stale stored index kept serving after the indexer changed, including on offline workspace search. Indexes now carry a capability signature and are rebuilt when it moves.
    - Fixed: a doc *about* an auth-like area escalated a typo fix to premium; the router escalated two thirds of requests because it bumped on a model's self-reported confidence (now 0% escalation over nine requests); post-merge attestation died on `exit 128` and reported green when it had done nothing.

    [npm v1.14.0](https://www.npmjs.com/package/@bashbop/otito/v/1.14.0) · [GitHub Release](https://github.com/BASHBOP/otito/releases/tag/v1.14.0) · [MCP Registry](https://registry.modelcontextprotocol.io/?q=io.github.BASHBOP%2Fotito)

!!! tip "v1.13.1 published (2026-09-20)"
    - The documentation pack is rewritten for a reader rather than its author: seven overlapping pages become one [deterministic verification](./07-deterministic-verification/README.md) page, and navigation is grouped by what you are trying to do.
    - The model router skill can offer a realtime canvas, at most once per session.

!!! tip "v1.13.0 published (2026-09-20)"
    - `otito route <repo> "<request>"` scores a coding task **before** tokens are spent on it and recommends a cheap, mid, or premium tier. otito answers the repository half deterministically; a System One model answers the request half with calibrated probabilities. It ships **advisory**, because the weights have never been graded against an outcome.
    - The router is not the gate and cannot become one. It runs before work starts; the gate runs after the diff exists. An unreachable or unkeyed model costs a tier, never a verdict.
    - Fixed: zero matched files read as a *contained* change, so the request a repository understood least was routed to the cheapest model. Absence now fails safe to the ceiling.
    - Nineteen report commands moved onto the shared document renderer, so every command reads like `review` and `impact`.

    [npm v1.13.0](https://www.npmjs.com/package/@bashbop/otito/v/1.13.0) · [GitHub Release](https://github.com/BASHBOP/otito/releases/tag/v1.13.0) · [MCP Registry](https://registry.modelcontextprotocol.io/?q=io.github.BASHBOP%2Fotito)

!!! tip "v1.12.0 published (2026-09-19)"
    - Model routing arrived as a prototype alongside [the routing doc](./18-model-routing/README.md), dogfooded on a production application where the first pass routed *every* request to premium and surfaced two defects worth recording.
    - A question whose answer never moves carries no information however well calibrated it is: asked as a yes/no, "is this request ambiguous?" returned 0.57 to 0.81 for every request including a typo fix.

    [npm v1.12.0](https://www.npmjs.com/package/@bashbop/otito/v/1.12.0) · [GitHub Release](https://github.com/BASHBOP/otito/releases/tag/v1.12.0) · [MCP Registry](https://registry.modelcontextprotocol.io/?q=io.github.BASHBOP%2Fotito)

!!! tip "v1.11.0 published (2026-09-19)"
    - `otito calibrate <repo>` grades the risk flags against the repository's own history, joining fix commits to the commits they repair by line overlap rather than by filename. Pointed at a small corpus it declines to answer most rows, which is the honest result.
    - `configuration` was two signals under one name: manifest-only commits were repaired at 0.42x the base rate, real config files at 2.03x. Merged, they cancelled out and inverted the risk bands, leaving `medium` changes *less* likely to be repaired than `low` at every window.
    - A zero-weight flag could gate a merge on its own; gating now requires a flag that scores.

    [npm v1.11.0](https://www.npmjs.com/package/@bashbop/otito/v/1.11.0) · [GitHub Release](https://github.com/BASHBOP/otito/releases/tag/v1.11.0) · [MCP Registry](https://registry.modelcontextprotocol.io/?q=io.github.BASHBOP%2Fotito)

See [CHANGELOG.md](https://github.com/BASHBOP/otito/blob/main/CHANGELOG.md) for the full history.

---

## :material-file-document-multiple: Documentation

### Getting started

| Document | What it covers |
| --- | --- |
| [Context Foundation](./01-context-foundation/README.md) | Repository inspection, maps, search, context packs, and harnesses |
| [MCP and Agents](./02-mcp-agent-workflows/README.md) | MCP tools and agent-facing workflows |
| [Publishing to npm and the MCP Registry](./02-mcp-agent-workflows/publishing.md) | How Òtítọ́ itself is released |
| [Codespaces and Tutorials](./08-tutorials-integration/README.md) | Setup and MCP onboarding alongside a tutorials repository |
| [Herdr Integration](./15-herdr-integration/README.md) | Context and merge evidence inside persistent agent workspaces |

### Using it

| Document | What it covers |
| --- | --- |
| [Trust-Layer Demo](./05-trust-layer-demo/README.md) | Òtítọ́ as a repeatable review workflow |
| [Contributor Governance](./03-contributor-governance/README.md) | Protected review, CODEOWNERS, required checks, and merge authority |
| [Release Readiness](./04-release-readiness/README.md) | SemVer, changelog discipline, CI, and release gates |
| [Usage Dashboard](./10-usage-dashboard/README.md) | Local usage logging and performance trends |
| [Builder-Founder Loop](./06-builder-founder-operating-loop/README.md) | Session rhythm, evidence ledger, and governance ladder |

### How it works

| Document | What it covers |
| --- | --- |
| [Deterministic Verification](./07-deterministic-verification/README.md) | Why merge evidence is computed from the repository, never from the model that wrote the change |
| [AX Score Spec](./07-deterministic-verification/ax-score-spec.md) | How agent experience is scored |
| [Convergence Score Spec](./07-deterministic-verification/convergence-score-spec.md) | How intent is measured against the diff that appeared |

### Measurement

| Document | What it covers |
| --- | --- |
| [Calibration](./17-calibration-thesis/README.md) | Grading risk flags against a repository's own history |
| [Model Routing](./18-model-routing/README.md) | Spending a calibrated model on the request side without touching the gate |

### Reference

| Document | What it covers |
| --- | --- |
| [Evaluation Guide](./EVALS.md) | The accuracy, harness, and gate-effectiveness evals |
| [Glossary](./GLOSSARY.md) | Terms used across these pages |

---

## :material-graph: Context Flow

```mermaid
flowchart LR
    A[Repo or workspace] --> B[Inspect shape]
    B --> C[Map files and symbols]
    C --> D[Build context pack]
    D --> E[Agent or reviewer]
    E --> F[Change]
    F --> G[PR review context]
    G --> H[Otito gate]
```

## Quick Start

=== "Install"

    ```bash
    npm install -g @bashbop/otito@1.14.0
    otito doctor
    otito context "review this change" --path .
    ```

=== "No Global Install"

    ```bash
    npx -y @bashbop/otito@1.14.0 doctor
    ```

=== "Source Checkout"

    ```bash
    git clone https://github.com/BASHBOP/otito.git
    cd otito
    npm ci
    npm run ci
    node src/cli.js doctor
    ```

=== "MCP"

    ```bash
    otito mcp
    ```

Prove the deterministic merge gate against the committed valid and adversarial corpus:

```bash
otito eval --gate-effectiveness
```

---
