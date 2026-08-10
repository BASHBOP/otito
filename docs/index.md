# :material-source-branch: Òtítọ́

## Local repo intelligence for agents and reviewers

**Prepared by:** Oluwasegun Olumbe<br>
**Status:** v1.0.0 — clean Òtítọ́ product cutover, ready for Bashbop publication<br>
**Category:** Practical AI governance for developers

> A Bashbop Ltd product for teams that want context before code changes, review prompts before merge, and less guessing in agent workflows.

---

!!! info "About Òtítọ́"
    Òtítọ́ is a local-first context system. It inspects repositories, builds code maps, creates task-aware context packs, prepares PR review harnesses, and exposes the same workflow through an MCP server.

    Its command-line and package identity is `otito`.

    :material-animation-play: See the [**How It Works** visual walkthrough](assets/otito-how-it-works.html) — a layered diagram of the discover → index → context → gate flow.

---

## :material-sparkles: What's New

!!! tip "v1.0.0 — Òtítọ́ clean cutover (2026-07-29)"
    - Start from a local checkout while npm publication is pending.
    - Run the deterministic CLI with **`otito`**.
    - Configure MCP with **`node /path/to/otito/src/cli.js mcp`**.

See [CHANGELOG.md](https://github.com/BASHBOP/otito/blob/main/CHANGELOG.md) for the full history.

---

## :material-file-document-multiple: Documentation Pack

| # | Document | Description | Status |
| :-: | --- | --- | :-: |
| 01 | [:material-map-marker-path: Context Foundation](./01-context-foundation/README.md) | Repository inspection, maps, search, context packs, and harnesses | :material-check-circle: Active |
| 02 | [:material-lan-connect: MCP and Agents](./02-mcp-agent-workflows/README.md) | MCP tools and agent-facing workflows | :material-check-circle: Active |
| 03 | Bashbop stewardship | Protected review, release discipline, and CODEOWNERS | :material-check-circle: Active |
| 04 | [:material-tag-check: Release Readiness](./04-release-readiness/README.md) | SemVer, changelog discipline, CI, and release gates | :material-check-circle: Active |
| 05 | [:material-play-circle: Trust-Layer Demo](./05-trust-layer-demo/README.md) | Òtítọ́ as a repeatable review workflow | :material-check-circle: Active |
| 06 | [:material-repeat: Builder-Founder Loop](./06-builder-founder-operating-loop/README.md) | Session rhythm, evidence ledger, governance ladder, and next-action rule | :material-check-circle: Active |
| 07 | [Harness Thesis & AX](./07-harness-thesis/README.md) | Why the harness matters more than the model, plus AX scoring | :material-check-circle: Active |
| 08 | [Tutorials Integration](./08-tutorials-integration/README.md) | Codespaces setup and MCP onboarding for tutorials | :material-check-circle: Active |
| 09 | [Convergence Thesis](./09-convergence-thesis/README.md) | Intent-vs-diff convergence scoring and receipts | :material-check-circle: Active |
| 10 | [Usage Dashboard](./10-usage-dashboard/README.md) | Local usage logging and performance trends | :material-check-circle: Active |
| 11 | [Determinism Thesis](./11-determinism-thesis/README.md) | Why model variance is structural and the harness is separate | :material-check-circle: Active |
| 12 | [Dual-Mode Thesis](./12-dual-mode-thesis/README.md) | Probabilistic generation beside deterministic verification | :material-check-circle: Active |
| 13 | [Prompt Determinism Thesis](./13-prompt-determinism-thesis/README.md) | Why prompt settings do not turn a model into a gate | :material-check-circle: Active |

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
    git clone https://github.com/BASHBOP/otito.git
    cd otito && npm ci && node src/cli.js doctor
    ```

=== "Local Checkout"

    ```bash
    npm ci
    npm run ci
    node src/cli.js doctor
    ```

=== "MCP"

    ```bash
    otito mcp
    ```

---
