# Otito for Herdr

Run Otito's context, impact, review, and exact staged-tree validation inside the Herdr workspace that already hosts your coding agents.

Herdr owns persistent terminals, panes, worktrees, and agent lifecycle. Otito remains a separate local-first trust authority. The plugin passes the active repository and selected task text to the installed `otito` CLI; it does not fork Otito's engines or make Herdr responsible for merge verdicts.

## Install

Requirements:

- Herdr 0.8.2 or newer
- Node.js 18.18 or newer
- Git
- Otito on `PATH`

```bash
npm install -g @bashbop/otito
otito doctor
herdr plugin install BASHBOP/otito/integrations/herdr
```

For local plugin development:

```bash
herdr plugin link /path/to/otito/integrations/herdr
herdr plugin action list --plugin bashbop.otito
```

Set `OTITO_BIN` to an explicit executable path if `otito` is not on `PATH`. Set `OTITO_REPO` only when you deliberately want to override the repository resolved from Herdr's active pane or worktree.

## Use

```bash
herdr plugin action invoke bashbop.otito.doctor
herdr plugin action invoke bashbop.otito.review
herdr plugin action invoke bashbop.otito.gate-staged
herdr plugin pane open \
  --plugin bashbop.otito \
  --entrypoint trust-status
```

The context and impact actions use selected terminal text as the task request when Herdr supplies a selection. The trust-status popup also lets you type a request interactively.

The staged gate runs Otito's protected validation plan against the exact staged Git tree. It does not commit, push, merge, or approve anything. Local evidence also does not prove hosted CI, GitHub approvals, CODEOWNERS decisions, or the absence of unresolved review conversations.

## Optional keybindings

Add plugin actions to `~/.config/herdr/config.toml`:

```toml
[[keys.command]]
key = "prefix+o"
type = "plugin_action"
command = "bashbop.otito.review"
description = "review current change with Otito"

[[keys.command]]
key = "prefix+g"
type = "plugin_action"
command = "bashbop.otito.gate-staged"
description = "validate staged change with Otito"
```

Plugin code runs as your user and is not sandboxed by Herdr. Review the manifest and scripts before installation, just as you would any editor or agent extension.
