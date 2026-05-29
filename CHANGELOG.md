# Changelog

All notable changes to this project are documented here.

This project follows SemVer.

## Unreleased

- Add `server.json` manifest at the repo root for publishing to the official MCP Registry at `https://registry.modelcontextprotocol.io/`. Lets `mcp-publisher publish` advertise `io.github.nugehs/repoctx` so any MCP host can discover and install repoctx as `npx -y @nugehs/repoctx mcp`.
- Track npm's normalization tweaks to `package.json` (relative `bin` paths, `git+`-prefixed `repository.url`) introduced by the v1.0.0 publish.

## v1.0.0 - 2026-05-29

- **Phase 1 — shared risk vocabulary + fancy renderer.** New `src/lib/risk-paths.js` exports canonical risk flags (`auth/security`, `money flow`, `data model`, `request surface`, `frontend/backend contract`, `configuration`, `large file diff`, `secret risk`), `classifyPath()` with kind-aware matching, `conceptsFromQuery()` for closing the "Apple → auth" inference gap. New `src/lib/render/fancy.js` adds boxed headers, status glyphs, verdict blocks, and `--no-emoji` plain mode for CI logs.
- **Phase 2 — `repoctx impact`.** Absorbs `impact-map`'s scoring formula and diff validation onto repoctx's AST code map. Concept-match boost, concept-mismatch penalty, path-token cap, owner-kind boost, and word-boundary risk classification fix the field-test regressions (Stripe refunds now ranks `stripe.processor.ts` #1, Apple sign-in now ranks `auth.controller.ts` #1).
- **Phase 3 — `repoctx pass`.** Absorbs `pullpass`'s local merge gate. New `release-check.js`, `policy.js`, `pass-local.js` deliver the standard / company / high-risk policy profiles, team / solo governance, and the eight deterministic checks. Bashbop regression matches pullpass output exactly.
- **Phase 4 — `repoctx pass-pr` + `repoctx review`.** Absorbs `pullpass`'s GitHub PR mode. New `codeowners.js`, `gh.js`, `pass-pr.js` deliver PR state, review decision, CODEOWNERS (with org/team membership), unresolved conversations (paginated GraphQL), branch protection, status checks (with annotation enrichment). New `review.js` ships the composite engine — impact + pr-review + pass in one call, with a derived confidence score.
- **New MCP tools.** `change_impact`, `merge_readiness`, `pr_merge_readiness`, `review_pr`.
- **Standalone repos.** `impact-map` and `pullpass` can be archived; repoctx is the canonical implementation.

## v0.3.2 - 2026-05-28

- Add Go source files to repoctx code maps.
- Classify Go `*_test.go` files as tests in code maps and PR review context.
- Keep deleted Go test files classified as tests through the PR fallback path.
- Suggest `go test ./...` for Go diffs in PR review context.

## v0.3.1 - 2026-05-28

- Add a public trust-layer demo walkthrough for repoctx plus PullPass.
- Add a dated trust-layer proof run with terminal captures for repoctx plus PullPass.

## v0.3.0 - 2026-05-28

- Add a MkDocs Material documentation site for repoctx.
- Add GitHub Pages deployment workflow for published docs.
- Add documentation sections for context foundation, MCP agent workflows, contributor governance, release readiness, roadmap, and glossary.
- Polish the docs home page card rendering and version labels.
- Add CI quality gates for format, lint, type/module validation, tests, coverage, audit, and smoke checks.
- Add governance docs for contributing, security reporting, code ownership, dependency updates, and releases.
- Add contributor issue/PR templates and document maintainer review before merge.
- Add SemVer release guidance and CI validation for package version consistency.
- Add a README design print and matching install identity print.
- Add local ESLint, Prettier, and TypeScript compiler configuration.
- Rename the canonical package/repository identity to `repoctx` while preserving the `dev-context` binary alias and `.dev-context/` artifact directory.
- Add a README usage examples table for common repoctx workflows.
