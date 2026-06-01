# Changelog

All notable changes to this project are documented here.

This project follows SemVer.

## Unreleased

- No changes yet.

## v1.2.0 - 2026-06-01

- **Multi-domain discoverability.** Files in feature subdirs are now tagged under both their root domain *and* the feature name. Previously `components/livestream/RecordingsPanel.tsx` lived only under `components`, so `find_domain('livestream')` returned zero. Now the same file matches both `components` and `livestream`. File records gain a `domains: string[]` field carrying the full tag set; the existing `domain` field keeps the primary classification for display and scoring. `find_domain`, `filterFiles` (kind/domain filter), `findFrontendApiClient`, and `context_pack` scoring (in both `catalog.js` and `context-engine.js`) all read from the full set. `summarizeDomains` now counts a file under each of its tags, so the per-repo domain summary on `repo_catalog` surfaces feature-level domains as first-class entries with their actual file counts.
- **Cache version bumped 3 → 4** because file records gained `domains`. On-disk `.dev-context/index.json` caches will rebuild on next access.
- **MCP registry manifest bumped to 1.2.0** so `server.json`, `package.json`, and `package-lock.json` publish the same release version.

## v1.1.0 - 2026-05-30

- **New: `repoctx eval` subcommand.** Runs a fixed task suite (`repo_overview`, `code_map`, `harness`, `context_pack`) on any target repo and reports tokens of repoctx output vs a deterministic naive-agent approximation. Includes a `coverage` column on `code_map` so a high savings% with low file coverage doesn't mask a language-adapter gap. `--json` output is CI-friendly for regression gating.
- **New: `repoctx data-access` subcommand.** Detects inline SQL strings (any language) and Prisma ORM calls; aggregates by source, operation, table, and file; produces a focused "data-access surface" report. New `dataAccess` field on file records; new `dataAccessFiles` / `dataAccessHits` summary keys; `context_pack` scoring boosts files that touch the DB by up to +15.
- **Language coverage: C#, Python, Java, Ruby, Rust.** Five new regex extractors following the Go-extractor precedent. C# captures `using`, `namespace`, `class`, `interface`, `struct`, `enum`, `record`, `method` with public/internal access. Python captures `import`/`from-import`, `class`, `def`/`async def`, with docstring/comment/string filtering. Java captures `import`, `package`, `class`, `interface`, `enum`, `record`, `method` with annotation-prefix tolerance. Ruby captures `require`/`require_relative`, `module`, `class`, `def`/`def self.x`, predicate/bang methods, with `=begin/=end` block-comment handling. Rust captures `use`, `mod`, `struct`, `enum`, `trait`, `fn`, `type` with `pub`/`pub(crate)` visibility.
- **Vendor-bundle filter for `context_pack` scoring.** New `isVendorFile` detector with four layers (vendor path segments, minified suffixes, library-name prefixes, line-length heuristic). Files marked `isVendor: true` are dropped from `context_pack` scoring so `js/Bootstrap.js`, `angular.min.js`, `jqueryv2.1.4.min.js` etc. no longer surface as primary or related files.
- **Cache version bumped 1 → 3** because file records gained `isVendor` and `dataAccess`. On-disk `.dev-context/index.json` caches will rebuild on next access.
- **`.gitignore`**: ignore Claude Code session state (`.claude/`) and Office lockfiles (`~$*`).

## v1.0.1 - 2026-05-29

- Add `mcpName: "io.github.nugehs/repoctx"` to `package.json` — required by the MCP Registry's ownership-proof check (the registry verifies that the published npm tarball declares the registry name it's claiming).
- Add `server.json` manifest at the repo root for publishing to the official MCP Registry at `https://registry.modelcontextprotocol.io/`. After this lands, `mcp-publisher publish` advertises `io.github.nugehs/repoctx` so any MCP host can discover and install repoctx as `npx -y @nugehs/repoctx mcp`.
- Round out `server.json` with `title`, `websiteUrl`, and `repository.id` so registry list views render a real display name + homepage and the registry can detect repo-resurrection attempts on the namespace.
- Trim the `server.json` description to fit the registry's 100-character cap (first publish attempt rejected at 272 chars).
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
