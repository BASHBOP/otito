# Changelog

All notable changes to this project are documented here.

This project follows SemVer.

## [1.4.0] - 2026-06-09

- **Fix `context_pack` returning zero primary files on small repos.** When task keywords match nothing in the index (common for broad queries like "improve SEO and performance" against a small Vite/React repo), `repoctx context` now falls back to a deterministic ranking of repo entrypoints, `main`/`app`/`index` files, and build configuration (`vite.config.*`, `webpack.config.*`, etc.), so `primaryFiles` is never empty while the repo has source files. An open question notes when the fallback was used; behavior for queries that do match the index is unchanged.
- **Soften release discipline for private repos under solo governance.** "Version metadata changed without a changelog update" is now `WARN` instead of `FAIL` when the repo's `package.json` has `"private": true` and `--governance solo` is active — a private site repo bumping its version is not a release. Public or publishable packages and team governance keep the hard `FAIL`, and version-file mismatches ("Version metadata files do not agree") remain `FAIL` in every configuration.
- Brand alignment: toolchain footer/badges.
- **GitHub Releases now cut automatically.** `.github/workflows/release.yml` gains a `github-release` job: after the npm publish succeeds, it extracts the matching version section from `CHANGELOG.md` and creates a GitHub Release for the pushed `v*` tag, so the Releases page stays in sync with npm.
- **README comparison section.** Add a factual "repoctx vs alternatives" table (Sourcegraph/Cody context, hand-written `CLAUDE.md` rules files, `grep`/`ripgrep`) so newcomers can place the tool quickly.

## v1.3.3 - 2026-06-05

- **Fix release-discipline false positive on dependency bumps.** `repoctx review`/`pass` no longer reports `FAIL` when a dependency or lockfile update touches `package.json`/`package-lock.json` without a changelog entry. Release discipline now compares the project version against the base ref and only requires a changelog when the version actually changes. This unblocks the `PullPass readiness` gate for Dependabot and other dependency PRs.

## v1.3.2 - 2026-06-05

- **Automated release pipeline.** Pushing a `vX.Y.Z` tag now publishes to npm with provenance, then publishes `server.json` to the MCP Registry via GitHub OIDC (`.github/workflows/release.yml`). A `prepublishOnly` gate runs the full quality suite before any publish.
- **Version drift guard.** `version:check` now fails the build unless `server.json` (manifest and package versions) matches `package.json`, so the npm package and the MCP manifest can never desync.
- **Real merge-readiness gate.** The required `PullPass readiness` status check is now produced by CI running repoctx's own `review` command (impact + PR review + local pass) on the diff, exiting non-zero only on a blocking `FAIL`. repoctx now dogfoods its own merge gate.
- **Trust signals.** Add `CODE_OF_CONDUCT.md`, README status badges (npm, CI, license, Node), and npm publish provenance.
- **Docs slimmed for the public site.** Remove internal go-to-market and historical pages (company demo/pilot material, dated proof/launch notes, the absorption study, the standalone roadmap, and the slide deck); the trust-layer section keeps a single conceptual overview.
- **Dependency hygiene.** Group Dependabot updates (GitHub Actions into one PR, npm minor/patch into another) and auto-merge low-risk patch/minor bumps once checks pass. Bump CI actions to current majors.

## v1.3.1 - 2026-06-02

- **Release-readiness cleanup.** Fix CI blockers by formatting the changelog and removing an unused `code-map` helper that tripped ESLint.
- **Version alignment.** Keep npm package metadata, `package-lock.json`, MCP registry manifest versions, and public docs aligned on v1.3.1.
- **Canonical impact workflow.** Update the builder-founder operating loop to use `repoctx impact` instead of the absorbed standalone `impact-map` analyzer.

## v1.3.0 - 2026-06-02

- **Documentation site brought current with v1.1 and v1.2.** Headline version stamps on `docs/index.md`, `docs/EXECUTIVE-SUMMARY.md`, and `docs/presentation.md` now reflect v1.2.0. Capability tables surface the `repoctx eval` token-savings suite, the `repoctx data-access` inline-SQL / Prisma surface, C# / Python / Java / Ruby / Rust code-map extractors, the vendor-bundle filter, and multi-domain file tagging (`domains: string[]`).
- **ROADMAP** gains Phase 2.6 (v1.1.0 — eval, data-access, broader languages) and Phase 2.7 (v1.2.0 — multi-domain discoverability), both marked complete.
- **MCP tool surface table** annotates `repo_map` with all eight supported languages, annotates `find_domain` with the multi-domain tag set, and adds two tools that were shipping but undocumented: `find_backend_route` and `find_frontend_api_client`.
- **`deploy-docs.yml` now triggers on `CHANGELOG.md`** so release commits redeploy the published site automatically, not just commits that touch `docs/**` or `mkdocs.yml`.

## v1.2.0 - 2026-06-01

- **Multi-domain discoverability.** Files in feature subdirs are now tagged under both their root domain _and_ the feature name. Previously `components/livestream/RecordingsPanel.tsx` lived only under `components`, so `find_domain('livestream')` returned zero. Now the same file matches both `components` and `livestream`. File records gain a `domains: string[]` field carrying the full tag set; the existing `domain` field keeps the primary classification for display and scoring. `find_domain`, `filterFiles` (kind/domain filter), `findFrontendApiClient`, and `context_pack` scoring (in both `catalog.js` and `context-engine.js`) all read from the full set. `summarizeDomains` now counts a file under each of its tags, so the per-repo domain summary on `repo_catalog` surfaces feature-level domains as first-class entries with their actual file counts.
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
