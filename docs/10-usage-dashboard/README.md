# Usage & Performance Dashboard

`otito dashboard` turns a local, opt-in usage log into a single self-contained
HTML page that answers two questions: **how is otito being used**, and **how
well is it performing** — without a server, an account, or any data leaving the
machine.

It is the observability companion to the trust layer: the same local-first,
deterministic discipline applied to otito's own usage.

## Quick start

```bash
otito telemetry on          # opt in (off by default)
otito context "add a tool" --path .
otito gate .
otito dashboard             # writes .dev-context/dashboard.html
```

Open `.dev-context/dashboard.html` in any browser — it works straight off disk
(`file://`), offline.

## What it shows

| Panel | Reads |
| --- | --- |
| Invocations / latency tiles | run counts and wall-clock duration per command and MCP tool |
| Token savings vs naive | the latest `otito eval` byte-ratio delta against a whole-file baseline |
| Gate pass rate / verdict mix | `PASS` / `WARN` / `FAIL` outcomes from `gate`, `pass`, and `review` |
| Convergence over time | `otito converge` scores (intent vs diff) as a trend |
| Recent artifacts / commits | existing `.dev-context/*.json` reports and recent git history |

Every tile and chart carries an interpretation tooltip, and a **"what this can't
show"** panel keeps the coverage gaps explicit (latency only for runs after
telemetry was enabled; signals only for commands that emit them; the
naive-savings number is a relative cross-build delta, not an absolute guarantee).

## Privacy & determinism

- **Off by default.** Capture is gated by the `telemetry` config key or the
  `OTITO_TELEMETRY` env var, and is forced off under CI unless explicitly
  opted in. There is no `init`-time nudge — you turn it on manually.
- **Local only.** Events append to `~/.dev-context/usage.jsonl`. Nothing is sent
  anywhere. The derived HTML lives under the repo's gitignored `.dev-context/`.
- **Shape, not content.** Each event records the command name, the *shape* of its
  arguments (key names only — never flag values, paths, or queries), latency,
  outcome, and the value signals the command already produced. Error text is
  reduced to a code/class (e.g. `ENOENT`), never the raw message.
- **Never on a deterministic channel.** Telemetry is a side file. It is never
  written to stdout or the MCP JSON-RPC stream, and wall-clock timestamps never
  feed a token estimate or a convergence receipt — enforced by a test that
  asserts `--json` and MCP output are byte-identical with telemetry on vs off.

## Commands

```bash
otito telemetry status        # show state, log location, size, event count
otito telemetry on | off      # toggle capture (writes the config key)
otito telemetry clear         # delete the local usage log
otito dashboard [<repo>] [--out file] [--json] [--clear] [--no-artifacts] [--no-git]
```

The repo grouping key in each event is a one-way hash of the repository root: it
is non-reversible, but **confirmable** against a candidate path — it groups runs,
it is not anonymity.
