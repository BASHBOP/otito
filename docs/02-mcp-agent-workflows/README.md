# MCP and Agent Workflows

repoctx can run as a stdio MCP server so agent hosts can ask for repository context without scraping terminal output.

---

## Start The Server

```bash
repoctx mcp
```

From a local checkout:

```bash
node src/cli.js mcp
```

---

## MCP Tool Surface

| Tool               | Purpose                                                                               |
| ------------------ | ------------------------------------------------------------------------------------- |
| `repo_inspect`     | Inspect repository shape, scripts, package managers, entrypoints, and git state       |
| `repo_map`         | Build a compact JSON code map with optional domain and kind filters                   |
| `repo_discover`    | Discover local repositories under workspace roots                                     |
| `repo_index`       | Generate local `.dev-context/index.json` files and catalog entries                    |
| `repo_catalog`     | List cataloged local repositories                                                     |
| `repo_search`      | Search cataloged repositories by path, route, import, export, symbol, or domain       |
| `context_pack`     | Build a task-aware context packet                                                     |
| `repo_harness`     | Generate setup, validation, runtime, and context commands                             |
| `workspace_report` | Build product-level context across multiple repos                                     |
| `pr_review`        | Generate diff-aware PR review context                                                 |
| `find_domain`      | Find domain files across one or more repos                                            |
| `find_file_kind`   | Locate routes, controllers, services, hooks, clients, schemas, tests, or source files |

---

## Agent Loop

```mermaid
sequenceDiagram
    participant User
    participant Agent
    participant repoctx
    participant Repo

    User->>Agent: Make a change safely
    Agent->>repoctx: context_pack(task, repo)
    repoctx->>Repo: Inspect files and git state
    repoctx-->>Agent: Primary files, related files, tests, patterns
    Agent->>Repo: Edit scoped files
    Agent->>repoctx: pr_review(base, head)
    repoctx-->>Agent: Review prompts and risk flags
    Agent->>User: Verified change summary
```

---

## Host Guidance

!!! success "Recommended agent behavior"
    Ask repoctx for context before planning broad work. Use the output to choose files to read, not as a replacement for source inspection.

!!! warning "Boundary"
    repoctx does not approve or merge code. Pair it with tests, code review, branch protection, and PullPass.
