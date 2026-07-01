---
name: repoctx-scope
description: Scope a change before implementation — impact ranking, AX score, and adversarial questions. Invoke when the task is ambiguous or blast radius matters.
---

# repoctx scope (procedure)

Use this **after** context, **before** editing — especially for risky or vague tasks.

## Steps

1. Rank likely owner files:

   ```bash
   repoctx impact . "<task>" --json
   ```

2. Score agent experience for the task:

   ```bash
   repoctx ax "<task>" --path . --json
   ```

3. Ask the user (or yourself) adversarially:
   - What files must **not** change?
   - Which tests prove this worked?
   - What would a maintainer reject?

4. Only then run `repoctx context` and start edits.

## After implementation

Measure intent vs execution:

```bash
repoctx converge "<task>" --base origin/main --path .
```

## MCP equivalents

- `change_impact`
- `agent_experience`
- `convergence_score`
