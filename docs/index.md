# :material-source-branch: Òtítọ́

## Independent trust infrastructure for agents and reviewers

**Prepared by:** Oluwasegun Olumbe<br>
**Status:** v1.8.1 published to npm, GitHub Releases, and the official MCP Registry<br>
**Category:** Practical AI governance for developers

> A Bashbop Ltd product for teams that want any coding agent to produce evidence a human can trust before merge.

---

!!! info "About Òtítọ́"
    Òtítọ́ is a local-first trust harness for coding agents. It maps repository context before a change, then produces deterministic impact, validation, ownership, and review evidence before merge. It complements model-native agent loops instead of replacing them.

    Its command-line and package identity is `otito`.

    :material-animation-play: See the [**How It Works** visual walkthrough](assets/otito-how-it-works.html) — a layered diagram of the discover → index → context → gate flow.

---

## What's New

!!! tip "v1.8.1 published (2026-09-03)"
    - Context packs tell hosts to keep the change in the smallest owner files.
    - Public contributor path: CONTRIBUTING, Code of Conduct, and contributor governance.
    - Clean code thesis names owner-file targeting instead of a cleaner agent.

    [npm v1.8.1](https://www.npmjs.com/package/@bashbop/otito/v/1.8.1) · [GitHub Release](https://github.com/BASHBOP/otito/releases/tag/v1.8.1) · [MCP Registry](https://registry.modelcontextprotocol.io/?q=io.github.BASHBOP%2Fotito)

See [CHANGELOG.md](https://github.com/BASHBOP/otito/blob/main/CHANGELOG.md) for the full history.

---

## :material-file-document-multiple: Documentation Pack

| # | Document | Description | Status |
| :-: | --- | --- | :-: |
| 01 | [:material-map-marker-path: Context Foundation](./01-context-foundation/README.md) | Repository inspection, maps, search, context packs, and harnesses | :material-check-circle: Active |
| 02 | [:material-lan-connect: MCP and Agents](./02-mcp-agent-workflows/README.md) | MCP tools and agent-facing workflows | :material-check-circle: Active |
| 03 | [:material-account-group: Contributor Governance](./03-contributor-governance/README.md) | Protected review, CODEOWNERS, required checks, and merge authority | :material-check-circle: Active |
| 04 | [:material-tag-check: Release Readiness](./04-release-readiness/README.md) | SemVer, changelog discipline, CI, and release gates | :material-check-circle: Active |
| 05 | [:material-play-circle: Trust-Layer Demo](./05-trust-layer-demo/README.md) | Òtítọ́ as a repeatable review workflow | :material-check-circle: Active |
| 06 | [:material-repeat: Builder-Founder Loop](./06-builder-founder-operating-loop/README.md) | Session rhythm, evidence ledger, governance ladder, and next-action rule | :material-check-circle: Active |
| 07 | [Harness Thesis & AX](./07-harness-thesis/README.md) | The original cost and agent-experience thesis, now subordinate to trust evidence | :material-check-circle: Active |
| 08 | [Tutorials Integration](./08-tutorials-integration/README.md) | Codespaces setup and MCP onboarding for tutorials | :material-check-circle: Active |
| 09 | [Convergence Thesis](./09-convergence-thesis/README.md) | Intent-vs-diff convergence scoring and receipts | :material-check-circle: Active |
| 10 | [Usage Dashboard](./10-usage-dashboard/README.md) | Local usage logging and performance trends | :material-check-circle: Active |
| 11 | [Determinism Thesis](./11-determinism-thesis/README.md) | Why model variance is structural and the harness is separate | :material-check-circle: Active |
| 12 | [Dual-Mode Thesis](./12-dual-mode-thesis/README.md) | Probabilistic generation beside deterministic verification | :material-check-circle: Active |
| 13 | [Prompt Determinism Thesis](./13-prompt-determinism-thesis/README.md) | Why prompt settings do not turn a model into a gate | :material-check-circle: Active |
| 14 | [Trust Harness Thesis](./14-trust-harness-thesis/README.md) | Why independent merge evidence outlasts generic agent orchestration | :material-check-circle: Active |
| 15 | [Herdr Integration](./15-herdr-integration/README.md) | Run Otito context and merge evidence inside persistent agent workspaces | :material-check-circle: Active |
| 16 | [Clean Code Thesis](./16-clean-code-thesis/README.md) | Clean code as owner files, focused diffs, and gates, not a cleaner agent | :material-check-circle: Active |

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
    npm install -g @bashbop/otito@1.8.1
    otito doctor
    otito context "review this change" --path .
    ```

=== "No Global Install"

    ```bash
    npx -y @bashbop/otito@1.8.1 doctor
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
