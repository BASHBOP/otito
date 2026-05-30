---
marp: true
theme: default
paginate: true
size: 16:9
header: "**repoctx** · context before change"
footer: "github.com/nugehs/repoctx · npm @nugehs/repoctx · v1.0.1"
style: |
  section {
    font-family: -apple-system, "SF Pro Text", Inter, system-ui, sans-serif;
    font-size: 26px;
    padding: 60px;
    background: #0b0d10;
    color: #e6edf3;
  }
  section.lead {
    text-align: left;
    padding: 80px;
  }
  section.lead h1 {
    font-size: 88px;
    line-height: 1.0;
    margin: 0 0 16px 0;
    letter-spacing: -2px;
  }
  section.lead h2 {
    font-size: 32px;
    font-weight: 400;
    color: #9ca3af;
    margin: 0;
  }
  h1, h2, h3 { color: #f0f6fc; letter-spacing: -0.5px; }
  h1 { font-size: 48px; margin-bottom: 8px; }
  h2 { font-size: 36px; }
  h3 { font-size: 28px; color: #58a6ff; }
  code {
    background: #161b22;
    color: #79c0ff;
    padding: 2px 8px;
    border-radius: 4px;
    font-family: "SF Mono", "JetBrains Mono", Menlo, monospace;
    font-size: 0.92em;
  }
  pre {
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 8px;
    padding: 20px 24px;
    font-size: 22px;
    line-height: 1.45;
  }
  pre code { background: transparent; color: #c9d1d9; padding: 0; }
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 22px;
  }
  th, td {
    border-bottom: 1px solid #30363d;
    padding: 10px 14px;
    text-align: left;
  }
  th { color: #58a6ff; font-weight: 600; }
  blockquote {
    border-left: 4px solid #58a6ff;
    color: #c9d1d9;
    padding: 4px 20px;
    margin: 24px 0;
    font-style: italic;
  }
  strong { color: #f0f6fc; }
  a { color: #58a6ff; }
  header, footer { color: #6e7681; font-size: 14px; }
  section::after { color: #6e7681; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; }
  .pill {
    display: inline-block;
    background: #161b22;
    border: 1px solid #30363d;
    color: #79c0ff;
    padding: 4px 12px;
    border-radius: 999px;
    font-size: 18px;
    margin: 2px 4px 2px 0;
  }
---

<!-- _class: lead -->
<!-- _paginate: false -->
<!-- _header: "" -->

# repoctx

## Local-first code context for coding agents and reviewers.

<br>

<span class="pill">v1.0.1</span> <span class="pill">Node ≥ 18.18</span> <span class="pill">MCP Registry</span> <span class="pill">MIT</span>

```
 ____   _____   ____    ___    ____   _____  __  __
|  _ \ | ____| |  _ \  / _ \  / ___| |_   _| \ \/ /
| |_) ||  _|   | |_) || | | || |       | |    \  /
|  _ < | |___  |  __/ | |_| || |___    | |    /  \
|_| \_\|_____| |_|     \___/  \____|   |_|   /_/\_\
```

---

## The problem

Coding agents and reviewers keep losing **the shape of the repo**.

- LLMs guess file locations, miss owners, hallucinate routes.
- Reviewers re-derive risk from scratch on every PR.
- Multi-repo context lives in tribal memory.
- "Where is auth handled?" gets answered four different ways.

> Context is the bottleneck — not model capability.

---

## What repoctx is

A single Node.js CLI **and** MCP server that produces deterministic, local-first context:

```
              ┌──────────────────────────────────┐
  your repo → │  inspect · index · map · search  │ → agent / reviewer
              │     context · harness · pr       │
              │     impact · pass · review       │
              └──────────────────────────────────┘
                       (all local, all JSON-first)
```

- **No cloud.** Runs against your working tree.
- **No vendor lock.** Markdown + JSON outputs.
- **No magic.** AST-backed code maps, deterministic risk flags.

---

## Install

```bash
# Global
npm install -g @nugehs/repoctx
repoctx doctor

# No-install
npx -y @nugehs/repoctx doctor

# From a checkout
node src/cli.js install
```

After install, `repoctx` is the primary command. `dev-context` remains as a legacy alias.

---

## The four jobs

| Job | Command | What you get |
| --- | --- | --- |
| **Inspect** one repo | `repoctx repo .` | Files, languages, scripts, entrypoints, git state |
| **Map** the code | `repoctx map .` | Domains, imports, exports, symbols, routes |
| **Frame** a task | `repoctx context "..."` | Primary files, related files, tests, validation |
| **Hand off** to an agent | `repoctx harness .` | Setup + validation + runtime + context bundle |

Everything else (`index`, `search`, `pr`, `impact`, `pass`, `review`, `mcp`) composes on top of these.

---

## `repoctx repo` — know the shape

```bash
repoctx repo . --json
```

Surfaces what an agent **must** know before touching code:

- Package metadata, scripts, language mix, package managers
- Likely entrypoints (`bin`, `main`, `module`, framework conventions)
- Git state — branch, tracked vs. untracked, ignored-heavy dirs
- Uses `git ls-files` so `.gitignore` is respected, not bypassed

---

## `repoctx map` — JSON-first code map

```bash
repoctx map . --json > .dev-context/map.json
```

AST-backed across TS / JS / Go:

- Files grouped by **domain** (auth, payments, frontend, infra…)
- Imports + exports + symbols + detected routes
- Go `*_test.go` correctly classified as tests
- Designed to be **token-budgeted** — agents read just the slice they need

---

## `repoctx context` — task-aware framing

```bash
repoctx context "add a new MCP tool" --path . --json
```

Given a natural-language goal, returns:

- **Primary files** ranked by relevance to the task
- **Related files** (sibling tests, callers, schemas)
- **Patterns** to mirror (how existing tools register, name, test)
- **Validation commands** to run before declaring done

The concept-inference layer closes the "Apple → auth" gap that naïve search misses.

---

## `repoctx impact` — risk-aware change scoring

> Absorbed `impact-map` in v1.0.

```bash
repoctx impact . --base origin/main
```

Combines the AST code map with a **canonical risk vocabulary**:

<span class="pill">auth/security</span> <span class="pill">money flow</span> <span class="pill">data model</span> <span class="pill">request surface</span> <span class="pill">frontend/backend contract</span> <span class="pill">configuration</span> <span class="pill">large diff</span> <span class="pill">secret risk</span>

Concept-match boost, kind-aware classification, word-boundary matching — Stripe-refund diffs surface `stripe.processor.ts` first; Apple-sign-in diffs surface `auth.controller.ts` first.

---

## `repoctx pr` — review context, on demand

```bash
repoctx pr . --base origin/main --out .dev-context/pr-review.md
repoctx pr . --number 123 --comment        # post inline on GitHub
```

For every diff:

- Changed files grouped by domain
- **Risk prompts** tailored per file kind
- Suggested test commands (incl. `go test ./...` for Go diffs)
- Optional GitHub comment thread enrichment

Works against a local diff **or** a live PR number.

---

## `repoctx pass` + `pass-pr` — local merge gate

> Absorbed `pullpass` in v1.0.

```bash
repoctx pass        # local working-tree gate
repoctx pass-pr 123 # GitHub PR gate
```

Eight deterministic checks across three policy profiles (**standard / company / high-risk**):

- PR state, review decision, CODEOWNERS (with org/team membership)
- Unresolved conversations (paginated GraphQL)
- Branch protection, status checks with annotation enrichment
- Team vs. solo governance modes

Output matches the standalone `pullpass` byte-for-byte.

---

## `repoctx review` — the composite engine

```bash
repoctx review 123
```

One call, three signals:

```
  impact      →  what this change touches & how risky
  pr-review   →  what reviewers should focus on
  pass-pr     →  is it actually mergeable
                ↓
        confidence score
```

The one command an agent runs before suggesting "merge it."

---

## MCP server — agents call repoctx natively

```bash
repoctx mcp                    # stdio MCP server
```

Published to the **official MCP Registry** as `io.github.nugehs/repoctx`. Any MCP host (Claude Desktop, VS Code, Cursor, custom agents) can install with:

```bash
npx -y @nugehs/repoctx mcp
```

Exposed tools include `repo_inspect`, `repo_map`, `repo_search`, `context_pack`, `change_impact`, `merge_readiness`, `pr_merge_readiness`, `review_pr`, `workspace_report`.

---

## Multi-repo: catalog, search, workspace

```bash
repoctx discover ~/projects --depth 2
repoctx index ~/projects --discover
repoctx catalog
repoctx search "events controller"
repoctx workspace ../web ../api --out .dev-context/workspace.md
```

- `.dev-context/index.json` per repo, a shared local catalog on top
- Ranked search across paths, domains, routes, imports, exports, symbols
- `workspace` produces product-level context across multiple repos in one report

---

## What ships in v1.0

<div class="cols">

**Built in**

- AST code maps (TS/JS/Go)
- Risk vocabulary + concept inference
- 8-check merge gate, 3 policy profiles
- GitHub PR mode (state, reviews, CODEOWNERS, conversations, checks)
- MCP server + Registry listing
- MkDocs documentation site

**Quality gates**

- `npm run ci` — format, lint, typecheck, version, tests, coverage, audit, smoke
- Coverage: 70% lines, 60% branches, 75% functions
- SemVer, CODEOWNERS, protected `main`, security reporting

</div>

---

## Architecture, one slide

```
 src/
  cli.js                    # single entry, dispatch only
  lib/
    repo.js, code-map.js    ── inspection + AST
    risk-paths.js           ── canonical risk vocabulary
    impact.js               ── change scoring
    pr-review.js, gh.js     ── PR context + GitHub I/O
    pass-local.js, pass-pr.js, policy.js   ── merge gate
    review.js               ── composite engine
    mcp.js, agent-tools.js  ── MCP server + tool schemas
    render/fancy.js         ── boxed terminal renderer (--no-emoji for CI)
```

Pure Node, one runtime dep (`typescript`), no daemons, no databases.

---

## Roadmap

- Broader language coverage in the AST code map (Python, Rust, Swift)
- More policy profiles + customizable check sets
- Workspace-level impact scoring across linked repos
- Tighter feedback loop from real company pilots → docs / gates / proof
- Continued MCP host compatibility as Claude Desktop, VS Code, Cursor evolve

See [`docs/ROADMAP.md`](ROADMAP.md) for the live list.

---

<!-- _class: lead -->

# Try it

```bash
npx -y @nugehs/repoctx doctor
npx -y @nugehs/repoctx context "what should I change?" --path .
```

<br>

- **npm**  ·  `@nugehs/repoctx`
- **GitHub**  ·  github.com/nugehs/repoctx
- **Docs**  ·  nugehs.github.io/repoctx
- **MCP Registry**  ·  `io.github.nugehs/repoctx`

<br>

> Context before change.
