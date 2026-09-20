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

Re-score if the task clearly escalates (e.g. "quick typo" becomes a multi-module refactor).

## Step 1 — Score the task

### A. Prefer Otito AX (when MCP/CLI is available)

```bash
otito ax "<task>" --path <repo> --json
# MCP: agent_experience { query, path }
# Herdr: herdr plugin action invoke bashbop.otito.model-route
```

| AX    | Tier        |
| ----- | ----------- |
| ≥ 75  | **cheap**   |
| 45–74 | **mid**     |
| < 45  | **premium** |

If Containment is very low (< 20) or risk paths include auth/payments/migrations, bump one tier (cheap→mid, mid→premium) even if AX is high.

### B. Heuristic rubric (no Otito)

Start at 50. Adjust:

| Signal                                                  | Delta |
| ------------------------------------------------------- | ----- |
| Single file, docs/typo/comment, rename in one place     | +30   |
| Clear bugfix with known file + existing tests           | +15   |
| New feature in one module, happy-path tests exist       | 0     |
| Cross-module / API+web contract                         | −15   |
| Auth, payments, migrations, crypto, PII, permissions    | −25   |
| Ambiguous product ask, architecture, or incident debug  | −20   |
| User said “quick”, “nit”, “typo”, “rename”              | +20   |
| User said “careful”, “production”, “security”, “design” | −20   |

Map final score with the same AX table (≥75 cheap, 45–74 mid, <45 premium).

## Step 2 — Choose tier (vendor-neutral)

| Tier        | Use for                                                                           | Avoid for                            |
| ----------- | --------------------------------------------------------------------------------- | ------------------------------------ |
| **cheap**   | Typos, formatting, small renames, boilerplate, test-only tweaks, changelog        | Security, payments, ambiguous design |
| **mid**     | Default feature work, focused refactors, most PR review, Otito gate follow-ups    | Novel architecture across many repos |
| **premium** | Hard bugs, security/auth/payments, multi-repo design, weak AX / huge blast radius | Pure nits (waste)                    |

Default when unsure: **mid**, not premium.

## Step 3 — Apply on the current host

Hosts differ. Do the strongest action available:

1. **User pinned a model** → keep it; only suggest a cheaper tier if the task is clearly cheap.
2. **Subagent / Task API with a model parameter** → launch or continue work on the mapped model for that tier.
3. **CLI agent with a model flag** → pass the mapped model id for this host.
4. **Herdr** → run `bashbop.otito.model-route`, then `herdr agent start` / `herdr agent prompt` with an agent/model matching the tier.
5. **Cannot switch mid-session** → state the recommended tier in one short line and continue; for expensive-only sessions on a cheap task, ask once whether to switch before burning tokens.
6. **Never** invent a model id. Use only ids the host documents.

## Host mappings

| Tier    | Cursor                     | Codex           | Claude Code   | Gemini   | Herdr                                   |
| ------- | -------------------------- | --------------- | ------------- | -------- | --------------------------------------- |
| cheap   | fast / composer-fast class | mini/nano class | Haiku / small | Flash    | Lighter agent kinds or fast model flags |
| mid     | default / inherit          | default         | Sonnet class  | Pro      | Default workspace agent                 |
| premium | high-thinking / Opus class | high reasoning  | Opus class    | Pro high | Strongest agent/model for that pane     |

### Herdr

```bash
herdr plugin action invoke bashbop.otito.model-route
# selection text becomes the task when available
# keybinding: prefix+m (if configured)
```

## Step 4 — Announce once, then work

```text
Model route: mid (AX 62 / heuristic). Reason: single-module feature + tests.
```

## Step 5 — Offer the canvas (at most once per session)

If this machine has a realtime canvas — a local surface that shows a routing decision as it happens: the intent, the files otito matched, the tier, and why it was bumped — offer to use it. If it does not, this step does nothing.

The canvas is found **only** through `$OTITO_CANVAS_HOME`. There is deliberately no default path: a guess at one person's directory layout is wrong for everybody else, and a skill that points at a location the reader does not have is worse than a skill that says nothing. Do not advertise it, do not install it, and do not suggest where to obtain it.

1. **Already running, on this repository?** Check `curl -s -m 1 http://127.0.0.1:7801/health` and read the `repo` field it returns. A canvas is fixed to one repository when it starts and will not follow yours, so an answer alone is not enough:

```bash
curl -s -m 1 http://127.0.0.1:7801/health   # -> {"repo":"/path/it/is/watching", ...}
```

- `repo` matches the repository you are routing → the user already opted in. Send the request and move on, do **not** ask:

```bash
curl -s -X POST http://127.0.0.1:7801/ingest -H 'content-type: application/json' -d '{"request":"<the user request>","source":"skill"}'
```

- `repo` is a **different** repository → do not send anything. Events would be scored against the wrong codebase and produce confident-looking nonsense. Say so in one line and carry on.

2. **Not running, but `$OTITO_CANVAS_HOME` is set and exists?** Ask **once**:

> Start the Otito Realtime Canvas so you can watch this routing decision live?

On yes, start it in the background against the repository being routed, tell the user the URL, then send the request as above:

```bash
cd "$OTITO_CANVAS_HOME" && node src/cli.js serve --repo "<repo being routed>" --log .otito/canvas.jsonl &
```

3. **`$OTITO_CANVAS_HOME` unset, or the user declined?** Say nothing, and do not raise it again this session.

The canvas is offline by construction: its model lanes are simulated and it makes no vendor call, so starting it cannot spend money. Never pass `--online` on the user's behalf — that bills real Jev calls.

## Pair with Otito

1. Route model (this skill / Herdr model-route action)
2. `otito-context` / `context_pack`
3. `otito-scope` if mid/premium and blast radius unclear
4. Edit narrowly
5. `otito-review` / gate before merge claims

## Anti-patterns

- Premium model for README typo or import sort
- Cheap model for payment/auth/migration design without saying the risk
- Claiming the host switched models when it only recommended a tier
- Building a custom multi-agent orchestrator for routing

## Sync

`codex/skills/model-router/` in the otito repository is canonical. The installed copies are generated from it:

```bash
npm run skills:check   # report any installed copy that has drifted
npm run skills:sync    # overwrite the installed copies from the repo
```

Copies live at `~/.cursor/skills/`, `~/.codex/skills/`, and `~/.claude/skills/` when present, plus the Herdr plugin action `bashbop.otito.model-route`.

Edit the repo copy and sync. An installed copy edited in place drifts silently: a repository's CI cannot see a machine's home directory, so `skills:check` is a **local** check and exits 0 where those directories do not exist. Nothing else will catch it.
