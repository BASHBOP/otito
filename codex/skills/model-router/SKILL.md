---
name: model-router
description: >-
  Score a coding task and route it to a cheap, mid, or premium model tier before spending tokens. Use at the start of any coding, review, debug, or planning request on any agent host (Cursor, Codex, Claude Code, Gemini, Kimi, Herdr, etc.). Prefer Otito agent_experience (AX) when available; otherwise use the heuristic rubric in this skill. Do not use an expensive model for trivial edits.
---

# Model router (host-agnostic)

Goal: spend premium models only when the task needs them. Works with **any** ML coding host, including agents launched inside Herdr panes. Otito scores cost/safety; this skill chooses the model tier.

This is routing, not orchestration. Do not spawn multi-agent loops.

## When to run

At the **start** of a user request (before large context packs or edits), unless the user already pinned a model.

## Step 1 — Score

Prefer Otito AX / Herdr `bashbop.otito.model-route`. Else use the heuristic in the Cursor/Codex copies of this skill.

| AX    | Tier    |
| ----- | ------- |
| ≥ 75  | cheap   |
| 45–74 | mid     |
| < 45  | premium |

Bump one tier if containment < 20 or auth/payments/migrations.

## Herdr

```bash
herdr plugin action invoke bashbop.otito.model-route
# prefix+m when configured
```

Then start/prompt the pane agent for that tier.

## Sync

Canonical: `otito/codex/skills/model-router/` and Cursor/Codex user skills.
