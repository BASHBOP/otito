# Migration to repoctx 2.0

repoctx 2.0 consolidates the MCP tool surface from **18 tools to 11**; v2.3 adds
`agent_experience` and `convergence_score` for a current total of **13** canonical
tools. The change is **fully backwards compatible**: every legacy tool name still
works through `tools/call`. `tools/list` advertises only the 13 canonical tools,
but calls to the old names are transparently forwarded (with argument translation)
to their successors.

> **Alias guarantee:** the legacy tool names keep working via `tools/call` until
> **repoctx 3.0**. They are hidden from `tools/list` in 2.0 and will be removed in
> 3.0. Migrate to the canonical names at your convenience before then.

## The 13 canonical tools

| Tool               | Purpose                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------- |
| `repo_inspect`     | Inspect repository shape, scripts, package managers, entrypoints, and git state          |
| `repo_map`         | Compact JSON code map, filterable by `domain`, `kind`, and `route`                       |
| `repo_index`       | Generate `.dev-context` indexes + catalog entries; `dryRun:true` discovers read-only     |
| `repo_search`      | Search the catalog; omit `query` to return the catalog listing                           |
| `context_pack`     | Build a task-aware context packet                                                        |
| `change_impact`    | Rank files most likely to own a plain-English change request                             |
| `agent_experience` | Score Agent Experience (AX 0–100): changeability, containment, guardrails, clarity (v2.3+) |
| `convergence_score`| Score intent vs. execution (0–100) with a recomputable receipt (v2.3+)                   |
| `review_context`   | Diff/comment review context (no verdict)                                                 |
| `review_gate`      | PASS/WARN/FAIL merge gate; local without `pr`, GitHub PR gate with `pr`                  |
| `review_verdict`   | Composite verdict: impact + review_context + review_gate, with a confidence score        |
| `workspace_report` | Product-level report across multiple repos                                               |
| `repo_harness`     | Setup, validation, runtime, and context commands for an agent or CI harness              |

## Old → new mapping

### Renames (1:1, same schema/behavior)

| Legacy name   | Canonical name   | Notes                          |
| ------------- | ---------------- | ------------------------------ |
| `pr_review`   | `review_context` | Diff/comment context, no verdict |
| `review_pr`   | `review_verdict` | Composite verdict              |

### Merges

| Legacy name          | Canonical name | Param translation                                          |
| -------------------- | -------------- | ---------------------------------------------------------- |
| `merge_readiness`    | `review_gate`  | `{path, base, policy, governance, request}` → same, no `pr` (local gate) |
| `pr_merge_readiness` | `review_gate`  | `{selector, ...}` → `{pr: selector, ...}` (GitHub PR gate) |

`review_gate` dispatches internally exactly as the two old tools did: with a `pr`
selector it runs the GitHub gate (`evaluatePR`); without one it runs the local
gate (`evaluateLocal`).

### Folds into `repo_map`

The four `find_*` tools are absorbed by `repo_map`'s `domain` / `kind` / `route`
filters. `repo_map` gained a `route` param that substring/regex-matches the
combined controller route (`controllerBasePath` + each `httpMethods` path) and
the file path — the same matching `find_backend_route` did.

| Legacy name                 | Canonical call                                              |
| --------------------------- | ----------------------------------------------------------- |
| `find_domain {path, domain}`        | `repo_map {path, domain, includeFiles:true}`        |
| `find_file_kind {path, kind}`       | `repo_map {path, kind, includeFiles:true}`          |
| `find_backend_route {path, query}`  | `repo_map {path, kind:"controller", route:query, includeFiles:true}` |
| `find_frontend_api_client {path}`   | `repo_map {path, kind:"apiClient", includeFiles:true}` |

### Folds into `repo_search` / `repo_index`

| Legacy name     | Canonical call                                  | Notes                                              |
| --------------- | ----------------------------------------------- | -------------------------------------------------- |
| `repo_catalog`  | `repo_search` with **no `query`**               | A query-less `repo_search` returns the catalog listing |
| `repo_discover` | `repo_index {discover:true, dryRun:true}`       | `dryRun` discovers + reports without writing indexes or mutating the catalog (read-only) |

## CLI changes

No CLI command was removed or renamed — full back-compat. One command was added:

- **`gate`** — the canonical merge-gate command. `repoctx gate <repo>` runs the
  local gate (delegates to `pass`); `repoctx gate --pr <selector>` runs the
  GitHub PR gate (delegates to `pass-pr`). The legacy `pass` and `pass-pr`
  commands remain available.

`review` remains the composite-verdict command, and `pr` remains the
review-context (no-verdict) command.

## Annotations

`readOnlyHint` annotations stay honest:

- `review_gate` with `pr` unset is read-only (local gate); with `pr` set it
  inspects GitHub but still does not mutate.
- `repo_index` with `dryRun:true` is read-only; without it, it mutates the catalog.
- `review_context` is non-read-only because `comment:true` can post a GitHub PR comment.
