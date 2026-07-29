---
name: otito-review
description: Run otito review and gate before merge — composite verdict, PR context, and PASS/WARN/FAIL checks. Invoke before declaring a PR merge-ready.
---

# otito review (procedure)

Use this **before** merge or when the user asks if a change is safe to land.

## Local changes

```bash
otito review . --request "<what changed>" --base origin/main --json
otito gate . --base origin/main
```

## GitHub PR

```bash
otito review . --pr <number> --json
otito gate --pr <number> --path .
```

## Interpretation

| Verdict | Action                                      |
| ------- | ------------------------------------------- |
| PASS    | No blocking signals; human still owns merge |
| WARN    | Inspect flagged checks explicitly           |
| FAIL    | Do not merge until resolved                 |

## MCP equivalents

- Review context only: `review_context`
- Gate only: `review_gate`
- Full composite: `review_verdict`

Treat gate output as deterministic evidence — not model opinion.
