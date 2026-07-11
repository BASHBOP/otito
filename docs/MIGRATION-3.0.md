# Migration to repoctx 3.0

repoctx 3.0 removes deprecated surfaces that 2.x kept for backwards compatibility.
Plan the upgrade before 3.0 ships.

## What 3.0 removes

| Surface | Removed in 3.0 | Replacement |
| --- | --- | --- |
| `dev-context` CLI bin | yes | `repoctx` |
| Legacy MCP tool names (18 retired names) | yes | 13 canonical tools — see [MIGRATION-2.0.md](./MIGRATION-2.0.md) |
| `pass` / `pass-pr` CLI aliases | planned | `repoctx gate` |
| `tools/list` legacy aliases | yes | canonical names only |

## Pre-migration checklist

1. **Search configs for `dev-context`**
   - MCP host configs, CI workflows, shell aliases, skills, and docs.
   - Replace with `repoctx` or `npx -y @nugehs/repoctx`.

2. **Search MCP configs for retired tool names**
   - `pr_review`, `review_pr`, `merge_readiness`, `pr_merge_readiness`
   - `repo_catalog`, `repo_discover`, `find_domain`, `find_file_kind`, `find_backend_route`, `find_frontend_api_client`
   - Map each call using [MIGRATION-2.0.md](./MIGRATION-2.0.md).

3. **Update CLI scripts**
   - `repoctx pass` → `repoctx gate <repo> [--base ref]`
   - `repoctx pass-pr` → `repoctx gate --pr <selector>`

4. **Run doctor and smoke after changes**

   ```bash
   repoctx doctor
   repoctx harness . --json
   ```

5. **Enable telemetry warnings (optional before 3.0)**
   - `repoctx telemetry on` logs legacy MCP alias usage locally to spot stragglers.

## Canonical MCP tools (3.0)

Same 13 tools as 2.3 — see [MCP and Agent Workflows](./02-mcp-agent-workflows/README.md).

## Timeline guidance

- **2.x:** legacy aliases work; deprecation warnings on `dev-context` bin only.
- **3.0.0-rc:** legacy MCP names removed from `tools/call`; migration window closes.
- **3.0.0:** `dev-context` bin removed; breaking semver bump.

Track release notes in [CHANGELOG.md](https://github.com/nugehs/repoctx/blob/main/CHANGELOG.md) for the exact 3.0 ship date.
