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

## Step 5 — Offer the canvas (at most once per session)

The [Otito Realtime Canvas](https://github.com/BASHBOP/otito-canvas) shows this routing decision as it happens: the intent, the files otito matched, the tier, and why it was bumped. Offering it is optional and must never interrupt the work.

1. **Already running, on this repository?** Check `curl -s -m 1 http://127.0.0.1:7801/health` and read the `repo` field it returns. A canvas is fixed to one repository when it starts and will not follow yours, so an answer alone is not enough:

```bash
curl -s -m 1 http://127.0.0.1:7801/health   # -> {"repo":"/path/it/is/watching", ...}
```

- `repo` matches the repository you are routing → the user already opted in. Send the request and move on, do **not** ask:

```bash
curl -s -X POST http://127.0.0.1:7801/ingest -H 'content-type: application/json' -d '{"request":"<the user request>","source":"skill"}'
```

- `repo` is a **different** repository → do not send anything. Events would be scored against the wrong codebase and produce confident-looking nonsense. Say so in one line and carry on.

2. **Not running, but installed?** Look for `$OTITO_CANVAS_HOME`, then `~/dev/otito-canvas`. If one exists, ask **once**:

> Start the Otito Realtime Canvas so you can watch this routing decision live?

On yes, start it in the background against the repository being routed, tell the user the URL, then send the request as above:

```bash
cd "${OTITO_CANVAS_HOME:-$HOME/dev/otito-canvas}" && node src/cli.js serve --repo "<repo being routed>" --log .otito/canvas.jsonl &
```

3. **Not installed, or the user declined?** Say nothing, and do not raise it again this session.

The canvas is offline by construction: its model lanes are simulated and it makes no vendor call, so starting it cannot spend money. Never pass `--online` on the user's behalf — that bills real Jev calls.

## Sync

Canonical: `otito/codex/skills/model-router/` and Cursor/Codex user skills.
