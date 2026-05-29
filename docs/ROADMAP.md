# repoctx Roadmap

## Phase 0 - Foundation

| Item                         |  Status  |
| ---------------------------- | :------: |
| Canonical `repoctx` identity | Complete |
| Legacy `dev-context` alias   | Complete |
| Repository inspection        | Complete |
| Code maps                    | Complete |
| Local catalog and search     | Complete |
| Context packs                | Complete |
| PR review context            | Complete |
| MCP server                   | Complete |
| MCP client install examples  | Complete |
| Contributor governance       | Complete |
| PullPass PR readiness gate   | Complete |
| PullPass context evidence link | Complete |
| Published documentation site | Complete |
| Public trust-layer demo      | Complete |
| Public launch note           | Complete |
| Company demo packet          | Complete |
| Company pilot runbook        | Complete |
| Sanitized proof index        | Complete |
| Review policy snapshot       | Complete |
| Company pilot feedback loop  | Complete |
| Builder-founder operating loop | Complete |

## Phase 1 - Public Adoption

- Keep launch notes and release notes current as the trust-layer workflow evolves.
- Keep MCP client install examples current as host configuration formats evolve.
- Add screenshots for common workflows; the first terminal proof run is captured.
- Use the builder-founder operating loop to keep long-running agent sessions tied to context, gates, decisions, and next actions.
- Run one real repository and pull request through the company pilot runbook.
- Keep the sanitized proof index current as public artifacts and private evidence boundaries evolve.
- Keep the review policy snapshot current as branch protection and PullPass gates evolve.
- Capture company feedback against the demo packet and turn repeated questions into docs or gates.

## Phase 2 - Trust-Layer Integration

- Promote PullPass from solo owner-decision visibility to team/company required checks when separate reviewers are available. (Complete in v1.0.0 — `repoctx pass --policy company|high-risk`.)
- Add policy profiles for auth, payments, database, deployment, and secret-adjacent changes. (Complete in v1.0.0 — see `src/lib/risk-paths.js`.)
- Add cross-repo workspace examples using Bashbop-style API/web/mobile repos.
- Decide which impact-map behaviors graduate into repoctx, starting with diff validation, import-neighbor evidence, missed-file detection, and risk-aware test suggestions. (Complete in v1.0.0 — `repoctx impact ... --diff-base`.)
- Keep impact-map as a separate analyzer only while it is proving ideas that are not ready for the repoctx product surface. (Closed in v1.0.0 — see `ABSORPTION-STUDY.md`.)

## Phase 2.5 - Absorption (Complete in v1.0.0)

- `impact-map` absorbed as `repoctx impact` with kind-aware penalties and concept-synonym boosts. See [Absorption Study](ABSORPTION-STUDY.md).
- `pullpass` local mode absorbed as `repoctx pass` with shared risk vocabulary.
- `pullpass` GitHub PR mode absorbed as `repoctx pass-pr` with CODEOWNERS team-membership and branch-protection checks.
- Composite `repoctx review` ships impact + pr_review + pass in one call with a derived confidence score.
- Four new MCP tools: `change_impact`, `merge_readiness`, `pr_merge_readiness`, `review_pr`.

## Phase 3 - Distribution

- Decide npm registry publication path.
- Publish release notes for public versions.
- Add package provenance/signing guidance.
- Create case studies from real repositories.
