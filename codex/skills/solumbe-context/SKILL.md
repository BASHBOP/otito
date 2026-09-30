---
name: solumbe-context
description: Run solumbe context before editing — task-aware primary files, tests, and validation commands. Invoke explicitly before planning or implementing a change.
---

# solumbe context (procedure)

Use this **before** the agent edits code.

## Steps

1. Run context for the task:

   ```bash
   solumbe context "<task description>" --path . --json
   ```

2. Read the **primary files**, **related files**, and **tests** from the packet.
3. Run the listed **validation commands** after changes.
4. Do not guess routes, owners, or scripts when solumbe can supply them.

## MCP equivalent

Call `context_pack` with the same task string and repository path.

## When to skip

- Trivial one-line doc typos with no behavioral risk.
- The user explicitly forbids solumbe for the task.
