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

## Phase 2.6 - Eval, data-access, and broader languages (Complete in v1.1.0)

- `repoctx eval` ships a fixed task suite (`repo_overview`, `code_map`, `harness`, `context_pack`) with a `coverage` column so high savings% with low file coverage cannot mask a language-adapter gap. `--json` output is CI-friendly for regression gating.
- `repoctx data-access` detects inline SQL strings (any language) and Prisma ORM calls; aggregates by source, operation, table, and file. File records gain a `dataAccess` field; `context_pack` scoring boosts files that touch the DB by up to +15.
- Code-map extractors land for C#, Python, Java, Ruby, and Rust, joining TS/JS/Go.
- Vendor-bundle filter drops `*.min.js`, `Bootstrap.js`, jQuery and similar from `context_pack` scoring so they no longer surface as primary files.

## Phase 2.7 - Multi-domain discoverability (Complete in v1.2.0)

- Files in feature subdirs are tagged under both their root domain *and* the feature name. `components/livestream/RecordingsPanel.tsx` now matches both `find_domain('components')` and `find_domain('livestream')`.
- File records gain a `domains: string[]` field carrying the full tag set; the existing `domain` field keeps the primary classification for display and scoring.
- `find_domain`, `filterFiles`, `findFrontendApiClient`, and `context_pack` scoring all read from the full set. `summarizeDomains` counts a file under each of its tags, so per-repo summaries on `repo_catalog` surface feature-level domains as first-class entries.
- Cache version bumped 3 → 4; existing `.dev-context/index.json` caches rebuild on next access.

## Phase 3 - Distribution

- Decide npm registry publication path.
- Publish release notes for public versions.
- Add package provenance/signing guidance.
- Create case studies from real repositories.
