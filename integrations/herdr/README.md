# Solumbe for Herdr

Run Solumbe's context, impact, review, and exact staged-tree validation inside the Herdr workspace that already hosts your coding agents.

Herdr owns persistent terminals, panes, worktrees, and agent lifecycle. Solumbe remains a separate local-first trust authority. The plugin passes the active repository and selected task text to the installed `solumbe` CLI; it does not fork Solumbe's engines or make Herdr responsible for merge verdicts.

## Install

Requirements:

- Herdr 0.8.2 or newer
- Node.js 18.18 or newer
- Git
- Solumbe on `PATH`

```bash
npm install -g @bashbop/solumbe
solumbe doctor
herdr plugin install BASHBOP/solumbe/integrations/herdr
```

For local plugin development:

```bash
herdr plugin link /path/to/solumbe/integrations/herdr
herdr plugin action list --plugin bashbop.solumbe
```

Set `SOLUMBE_BIN` to an explicit executable path if `solumbe` is not on `PATH`. Set `SOLUMBE_REPO` only when you deliberately want to override the repository resolved from Herdr's active pane or worktree.

## Use

```bash
herdr plugin action invoke bashbop.solumbe.doctor
herdr plugin action invoke bashbop.solumbe.model-route
herdr plugin action invoke bashbop.solumbe.review
herdr plugin action invoke bashbop.solumbe.gate-staged
herdr plugin pane open \
  --plugin bashbop.solumbe \
  --entrypoint trust-status
```

`model-route` scores the selected task (or a default request) with Solumbe AX and prints a **cheap / mid / premium** recommendation before you spend tokens on a coding agent.

The context and impact actions use selected terminal text as the task request when Herdr supplies a selection. The trust-status popup also lets you type a request interactively.

The staged gate runs Solumbe's protected validation plan against the exact staged Git tree. It does not commit, push, merge, or approve anything. Local evidence also does not prove hosted CI, GitHub approvals, CODEOWNERS decisions, or the absence of unresolved review conversations.

## Optional keybindings

Add plugin actions to `~/.config/herdr/config.toml`:

```toml
[[keys.command]]
key = "prefix+o"
type = "plugin_action"
command = "bashbop.solumbe.review"
description = "review current change with Solumbe"

[[keys.command]]
key = "prefix+g"
type = "plugin_action"
command = "bashbop.solumbe.gate-staged"
description = "validate staged change with Solumbe"

[[keys.command]]
key = "prefix+m"
type = "plugin_action"
command = "bashbop.solumbe.model-route"
description = "route model tier with Solumbe AX"
```

Plugin code runs as your user and is not sandboxed by Herdr. Review the manifest and scripts before installation, just as you would any editor or agent extension.
