# Herdr Integration

Herdr is a persistent terminal runtime for coding agents. Solumbe is the
independent context and merge-evidence layer inside that runtime.

```text
Herdr workspace/worktree -> coding agent -> changed files
                                      |
                                      v
                       Solumbe context/impact/review/gate
                                      |
                                      v
                    evidence -> hosted checks -> human decision
```

The integration is a Herdr v1 plugin under `integrations/herdr`. It exposes:

- task-aware context, using selected text when available
- change-impact mapping against the active repository
- model-tier routing from Solumbe AX (`model-route`: cheap / mid / premium)
- the composite Solumbe review verdict
- protected validation against the exact staged Git tree
- an interactive trust-status popup

Install Solumbe and then the plugin:

```bash
npm install -g @bashbop/solumbe
solumbe doctor
herdr plugin install BASHBOP/solumbe/integrations/herdr
```

Open the trust view:

```bash
herdr plugin pane open \
  --plugin bashbop.solumbe \
  --entrypoint trust-status
```

The plugin does not embed an agent, replace Herdr's runtime, or let an agent
award itself approval. Solumbe stays independently installable and keeps its own
deterministic JSON/CLI contracts. Herdr contributes invocation context: the
active workspace, worktree, pane, repository, and selected task text.

Local verdicts remain local evidence. Hosted CI, GitHub approvals, CODEOWNERS,
unresolved review conversations, and the final merge decision stay with their
respective authorities.

See the plugin's
[README](https://github.com/BASHBOP/solumbe/tree/main/integrations/herdr) for
actions, keybindings, local development, configuration overrides, and the
security boundary.
