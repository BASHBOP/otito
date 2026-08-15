# Changelog

All notable changes to this project are documented here.

This project follows SemVer.

## [Unreleased]

## [1.6.2] - 2026-08-15

### Changed

- **Faster CLI startup.** Commands now load their implementation modules only when invoked, so lightweight paths such as `otito --version` and `otito help` avoid loading the TypeScript analysis engine.

### Added

- **Repeatable CLI benchmarks.** `npm run benchmark:cli` measures version, help, and full context execution with human-readable or JSON output for same-machine comparisons.
- **Lazy-loading regression coverage.** Subprocess tests fail if lightweight commands begin importing the TypeScript analysis engine again.

## [1.6.1] - 2026-08-12

### Changed

- **Shared terminal summaries.** Catalog, init, install, and related CLI surfaces now use a compact human-first terminal summary helper. JSON and Markdown outputs stay on their dedicated serializers.

### Docs

- Expanded harness, dual-mode, and prompt-determinism thesis pages, plus executive-summary and site index updates.

### Maintenance

- Dev dependency minor and patch bumps.

## [1.6.0] - 2026-08-02

### Added

- **Template-aware convergence.** Handlebars templates, translations, feature-flag configuration, snapshots, and changelogs now participate in code maps and expected supporting-change fan-out.
- **Campaign email retrieval evaluation.** A generic, cross-repository fixture protects template and owner ranking learned from real Audience Studio work.
- **Versioned validation policy.** Otito can execute an approved base-committed validation plan against the exact staged tree and retain a bounded, privacy-preserving receipt.

### Changed

- **Actionable gate evidence.** Impact distinguishes required owners from supporting artifacts and advisory inspection leads; bouncer and production-configuration warnings state their exact repair or maintainer action.

## [1.3.0] - 2026-08-02

### Added

- **Workspace staged Gate.** `otito workspace-gate` binds two or more repositories' exact staged Git trees, local-gate checks, and validation receipts into one deterministic parent receipt for a product change.
- **Executed validation receipts.** `otito gate --staged --run-validation` runs a versioned base-committed validation plan against an isolated materialisation of the staged tree, pins package-manager script identity to the selected base (including npm, pnpm, Yarn, Bun, and Corepack forms), uses a scrubbed opt-in environment, and records bounded command outcomes and hashes without retaining raw output.
- **Trusted-agent workflow guidance.** The same local-first workflow is documented for Codex, Claude, Cursor, Gemini, Kimi, and structured handoffs; GitHub review, hosted CI, and mergeability remain separate authorities.

### Changed

- **More accurate change impact.** Handlebars templates, translations, feature-flag configuration, snapshots, and changelogs are indexed. Impact now distinguishes required owners from predictable supporting fan-out and advisory inspection leads.
- **Actionable risk and compliance warnings.** Production configuration warnings state the maintainer approval or safe unstage action; bouncer evidence includes its repair action and a reproducible recheck command.

## [1.2.1] - 2026-07-30

### Fixed

- **Standard CLI version flags.** `otito --version` and `otito -v` now print the exact installed package version and exit successfully. The packed-tarball smoke test protects the npm binary path against regressions.

## [1.2.0] - 2026-07-30

### Added

- **Explicit anonymous usage sharing.** Developers can opt in with `otito telemetry share on` and opt out again with `otito telemetry share off`. Otito sends a fixed nine-field command outcome event through the first-party Bashbop relay.

### Privacy

- **Off by default and shape only.** Usage sharing remains disabled until the developer opts in, and disabling local telemetry also disables sharing. Events exclude prompts, arguments, paths, repository names, source code, errors, receipts, user identities, and email addresses.

## [1.1.1] - 2026-07-29

### Fixed

- **Plain-English signup verification context.** Questions such as “where is email verification implemented during signup?” now prioritise the registration controller, OTP verification, and unverified-login flow ahead of generic email operations.
- **Readable terminal context reports.** `otito context` now presents its detailed report with colour-aware sections, emojis, ranked hotspots, focused route summaries, tests, commands, and an agent handoff. Markdown artifacts and JSON output remain unchanged.

### Added

- **Signup verification retrieval evaluation.** The scored corpus now protects the plain-English authentication query against future ranking regressions.

## [1.1.0] - 2026-07-29

### Added

- **Harness execution eval.** `otito eval --harness` now proves that Otito infers and can run the encoded install, test, typecheck, and build commands against an isolated, committed fixture. `npm run eval:harness` is part of the release quality gate.

### Safety

- **Fixture-only execution boundary.** Harness execution accepts only vetted package-manager command forms, disables install lifecycle scripts, applies a timeout, and rejects corpus entries outside Otito's committed `evals/fixtures` directory. It never executes a command inferred from a customer repository.

## [1.0.3] - 2026-07-29

### Fixed

- **Trustworthy impact evidence.** Change impact now surfaces every mapped file from the requested Git diff as exact evidence, preserves the heuristic-only scorecard, and reports unmapped files explicitly.
- **Read-only repository inspection.** Code-map caching now lives in a per-user external cache rather than creating `.otito/index.json` inside inspected repositories.
- **Composite review statistics.** Review summaries now report the actual additions and deletions from the PR comparison.
- **Generated artifact hygiene.** Formatting ignores legacy generated context reports so source validation reflects the checked-in source.

## [1.0.2] - 2026-07-29

### Fixed

- **MCP Registry ownership namespace.** The manifest and published package now use the exact GitHub OIDC namespace granted to Bashbop: `io.github.BASHBOP/otito`. This allows the signed release workflow to publish the server to the MCP Registry.

## [1.0.1] - 2026-07-29

### Fixed

- **Trusted npm publishing.** Releases now use GitHub Actions OIDC for provenance; the temporary bootstrap token path has been removed.
- **Colour-stable release validation.** Terminal colour settings no longer block the release test suite.

## [1.0.0] - 2026-07-29

### Changed

- **Clean product cutover to Òtítọ́.** The package is now `@bashbop/otito`, the CLI is `otito`, and the MCP server identity is `io.github.bashbop/otito`.
- **Fresh configuration and artifact namespaces.** Configuration uses `.otitorc.json`, `~/.config/otito/config.json`, and `OTITO_*` environment variables. Local evidence artifacts, indexes, catalog, and telemetry now live under `.otito/`.
- **Bashbop stewardship.** Repository, documentation, release, and MCP metadata now point to Bashbop Ltd. The public contributor programme material has been removed while the protected-review rule remains owned by the Bashbop team.

## [1.1.2] - 2026-07-30

### Fixed

- **Plain-language developer routing.** Context now caps dense type/export evidence, recognises QR check-in vocabulary, and retains form-control identifiers for privacy and configuration questions. This keeps behaviour-owning screens, controllers, and hotspots ahead of support-only declarations.

### Added

- **Exact change-subject convergence receipts.** Receipt v2 binds staged convergence to the resolved base, parent commit, and immutable Git index tree; GitHub PR convergence binds to the target repository, PR number, and exact base/head OIDs. Legacy subject-less receipt IDs remain unchanged.

### Changed

- `repoctx converge --staged` and the MCP `convergence_score` staged option now measure the captured index tree. Snapshot scoring streams raw Git blobs without executing checkout filters, caps exact-subject analysis at 5,000 source files or 64 MiB, ignores local replace refs, and preserves NUL-delimited paths. Diff comparisons force changed gitlinks to remain visible and fix rename detection at 50% with a 1,000-candidate ceiling. PR verification uses GitHub's merge-base-to-head file semantics and fails closed on missing OIDs, an incomplete file list, a mismatched local head, or a dirty checkout. Subject-bound enforcement uses the full SHA-256 inputs hash; the 12-hex `rcpt_` value remains a display handle.

## [2.6.0] - 2026-07-27

### Added

- **Automatic staged pre-commit Gate.** `repoctx gate --staged` now evaluates exactly the files already staged for commit, provides an opt-in Git hook installer, and records scope-aware receipts. The same staged safety check is available through the built-in MCP server for IDE and agent integrations.

## [2.5.0] - 2026-07-24

### Release note

- Version 2.4.0 was prepared in source but was never tagged or published. Version 2.5.0 is the first public package since 2.3.1 and includes the complete change set below.

### Added

- **Load-bearing convergence evidence in merge gates.** `repoctx gate` can now recompute a task-to-diff convergence score, enforce `--min-convergence`, and verify a supplied `--receipt`; the same options are available through the MCP review gate so agents and humans can require matching intent before merge.
- **Tieline contract evidence in local gates.** Repositories with `tieline.config.json` now receive deterministic frontend-to-backend contract-drift results as first-class Gate evidence.
- **Bouncer compliance evidence in local gates.** Repositories with `bouncer.config.json` now receive configured compliance-control findings with explicit pass, warning, or fail status.
- **Aiglare AI-governance evidence in local gates.** Setting `REPOCTX_AIGLARE=1` adds irreversible AI-surface checks to the Gate receipt, including blocking guardrail failures.
- **TypeScript/JavaScript class methods in the code map** so Nest services expose `sendX` / `resolveY` symbols (including arrow property methods), not only top-level classes/types.
- **Context engine v2 answer-shaped packs**: multi-token method hotspots, domain diversification in primary files, plural/British spelling token variants, and topic→domain implementation boosts so queries like email branding land on `email.service.ts` instead of flooding with booking controllers.
- **Index cache version bump to 5** so existing `.dev-context/index.json` files regenerate and pick up method symbols.
- **`repoctx-self-improve` skill** (gated self-eval loop): score context gaps, add corpus/fixture cases, fix ranking/extractors, verify with `score-gap.mjs` — commit/PR only when asked.

### Changed

- **Gate evidence engine v2** resolves configured, workspace-local, Repoctx-local, IDE-bundled, or PATH tool binaries without shell-composed commands and records their structured evidence in the durable Gate report.
- **Durable post-merge audit reconciliation** now runs after successful CI, recovers Dependabot auto-merges that suppress push workflows, validates and backfills missing first-parent commits, archives the incomplete pilot v1 ledger, and persists the verified canonical hash chain on an `audit-ledger` branch plus per-commit artifacts.
- **CI trigger and dependency maintenance policy** now runs branch validation once per PR, reserves push validation for `main`, adopts `actions/setup-node@v7`, and requires explicit migration work for TypeScript major upgrades.

### Fixed

- **Historical attestation metadata** now resolves the PR, author, and commit time from the commit being attested instead of whichever commit happens to be checked out.
- **Blocking audit verdicts** are now recorded faithfully instead of treating a valid nonzero `FAIL` result as unavailable and silently replacing it with diff fallback.
- **Release documentation** now matches npm and MCP Registry OIDC trusted publishing instead of referring to a removed `NPM_TOKEN` flow.

## [2.3.1] - 2026-07-01

### Fixed

- **Ship `evals/` in the npm package** so `repoctx eval --accuracy` works from a global install; tarball smoke now verifies it.
- **Consolidate accuracy eval fixtures under `evals/fixtures/`** so the published tarball is self-contained (no dependency on `codex/skills/.../evals/files`).
- **Sync MCP docs to 13 canonical tools** (`agent_experience`, `convergence_score` added in 2.3); README, migration doc, and MCP workflow guide updated.
- **Add project `.cursor/mcp.json`** so Cursor loads repoctx MCP from a local checkout without a global install.
- **Link audit-pilot** from the trust-layer demo walkthrough as the post-merge attestation example.
- **Post-merge attestation CI** on pushes to `main` via `scripts/post-merge-attest.sh`.
- **`tests/gh.test.js`** and **`tests/attest.test.js`** for `gh.js` and audit-chain verification.
- **Procedure skills** under `codex/skills/repoctx-{context,review,scope}/`.
- **`docs/MIGRATION-3.0.md`** pre-migration checklist for the v3.0 alias removal.

## [2.3.0] - 2026-06-20

### Deprecated

- **The `dev-context` command alias is deprecated and will be removed in v3.0.0.** Use `repoctx`. Invoking the CLI through the `dev-context` bin now prints a deprecation warning to stderr (never on `--json` stdout). The `.dev-context/` output directory is unaffected — it is not part of the deprecation.

### Added

- **`repoctx dashboard` renders a local usage & performance UI.** A new opt-in telemetry layer records one JSONL line per CLI run and per MCP tool call to `~/.dev-context/usage.jsonl` (command, arg _shape_ — keys only — latency, outcome, and the value signals each command already produces). `repoctx dashboard` aggregates that log (plus existing `.dev-context` artifacts and recent git history) into ONE self-contained HTML file — no server, no chart library, no network — with interpretation tooltips on every tile and chart and a "what this can't show" honesty panel. Capture is **off by default** and strictly local: gated by the `telemetry` config key or `REPOCTX_TELEMETRY`, forced off under CI, never written to stdout or the MCP JSON-RPC channel (a determinism-firewall test enforces byte-identical output on/off), and error text is reduced to a code/class so no paths leak. Manage it with `repoctx telemetry status|on|off|clear`.
- **`repoctx ax "<task>" --path .` scores Agent Experience (AX).** A single 0–100 number for "how cheap and safe is it for an agent to make this change here?", blending Changeability (token cost), Containment (blast radius), Guardrails (tests/validation/CODEOWNERS/CI), and Clarity. Deterministic and composed from the existing `impact`, `tokens`, and `codeowners` engines — no new analysis. Supports `--json` and `--out`, and is exposed over MCP as the `agent_experience` tool (the MCP surface bumps from 11 to 12 tools). See [docs/07-harness-thesis/ax-score-spec.md](docs/07-harness-thesis/ax-score-spec.md).
- **`repoctx converge "<task>" --base <ref>` scores convergence.** A deterministic 0–100 measure of the distance between a stated task (intent) and the actual git diff (execution), with sub-scores for Coverage (did the intent happen?), Scope (did only the intent happen?), and Risk alignment (did unrequested drift land on risk-sensitive paths?). Emits a recomputable, timestamp-free receipt as durable evidence. Composed from the `change_impact` diff comparison and the shared risk vocabulary — no model, no new analysis. Supports `--json` and `--out`, and is exposed over MCP as the `convergence_score` tool (the MCP surface bumps from 12 to 13 tools). See [docs/09-convergence-thesis/convergence-score-spec.md](docs/09-convergence-thesis/convergence-score-spec.md).
- **`postinstall` runs `repoctx doctor` after a global install.** `npm install -g @nugehs/repoctx` now prints an environment readiness summary. The hook is guarded: it runs only for global installs (`npm_config_global=true`), skips in CI and when `REPOCTX_SKIP_POSTINSTALL` is set, and always exits 0 so it can never fail an install.

## [2.2.0] - 2026-06-17

### Added

- **ANSI color in the terminal renderer.** `createRenderer` now colorizes status lines (green/yellow/red), verdicts (bold + colored), tips (cyan), and dims box borders. Color is opt-in by detection and fully spec-compliant: `NO_COLOR` (any value) disables it, `FORCE_COLOR`/`CLICOLOR` force it, and it stays off when stdout is not a TTY (pipes, CI, test runners) so machine-readable output is never polluted. `visualWidth()` strips ANSI escapes before measuring, so box alignment is unaffected. New `--color` / `--no-color` flags.
- **Persistent configuration.** New `src/lib/config.js` loads merged settings with precedence defaults → user global (`~/.config/repoctx/config.json`, honoring `XDG_CONFIG_HOME`) → repo-local (`.repoctxrc.json`, walked up from the cwd) → environment (`REPOCTX_EMOJI`, `REPOCTX_COLOR`, `REPOCTX_THEME`, `REPOCTX_WIDTH`, `NO_COLOR`) → CLI flags. New `repoctx config get|set|list` command, with `set --local` writing to `.repoctxrc.json`. Known keys: `emoji`, `color`, `theme`, `width`, `policy`, `governance`.
- **Named themes** (`--theme <name>` or the `theme` config key): `default` (auto-detect), `color` (force color on), `minimal` (pure ASCII, no emoji or color), and `high-contrast` (bright ANSI palette). Themes set defaults that explicit `--color`/`--emoji` flags still override.
- **Mermaid diagram export** via `--mermaid` on `impact`, `map`, `workspace`, `data-access`, `review`, and `report`. Prints a fenced `mermaid` block to stdout, or writes a file with `--out`. Diagrams: impact concept/file flowchart, code-map domain distribution (`xychart-beta`), workspace repo-integration graph, data-access file→table flowchart, review gate-to-verdict flowchart, and a report language `pie` chart.

## [2.1.0] - 2026-06-12

### Added

- **`repoctx init` now scaffolds a real CI quality gate and an optional pre-commit hook**, derived from `repoctx harness`. The generated `repoctx-ci.yml` gains a `quality` job that runs the project's detected setup + validation commands (install → lint/typecheck/test/build/audit, with toolchain setup for npm/pnpm/yarn/bun) alongside the existing PR-review job. A dependency-free `.githooks/pre-commit` hook runs only the fast static checks (lint/format:check/typecheck) — slow gates stay in CI. Repos with no detectable scripts are unchanged (review-only workflow, no hook).
- `init` prompts interactively only at a TTY; MCP, agents, CI, and `--json`/`--yes` callers stay fully non-interactive. New flags: `--no-gates`, `--no-precommit`, `--hooks-path` (sets `git core.hooksPath .githooks` with consent), and `--yes`. `initProject()` stays pure — all decisions arrive as explicit options.
- CI install steps use frozen lockfile installs only when the matching lockfile is present; lockfile-less repos keep a plain install command.

## [2.0.0] - 2026-06-10

Major version: the MCP tool surface changed. Every legacy tool name still works via `tools/call` (guaranteed until 3.0) — see [docs/MIGRATION-2.0.md](docs/MIGRATION-2.0.md).

### Changed

- **MCP tool surface consolidated from 18 tools to 11.** `pr_review` → `review_context`, `review_pr` → `review_verdict`; `merge_readiness` + `pr_merge_readiness` → `review_gate` (a `pr` param selects local vs GitHub mode); the four `find_*` tools fold into `repo_map` (new `route` param); `repo_catalog` folds into `repo_search` (query now optional); `repo_discover` folds into `repo_index` (new `dryRun` param). `tools/list` advertises the 11 canonical tools; all 18 legacy names keep working through a back-compat alias layer.
- The whole `src/` tree is now type-checked: `checkJs` is enabled and the codebase carries JSDoc annotations (1393 → 0 errors), so `npm run typecheck` is a real type check rather than syntax-only. No runtime behavior changed.

### Added

- **Accuracy eval corpus.** `repoctx eval --accuracy` scores retrieval precision@5 / recall@5 / MRR and risk-classification accuracy against a 32-case labeled corpus, exiting non-zero below tunable thresholds. Wired into the quality gate so retrieval/risk regressions now block CI. Baseline: p@5 0.933, r@5 1.0, MRR 1.0, risk accuracy 1.0. See [docs/EVALS.md](docs/EVALS.md).
- `repoctx gate <repo>` (local) / `gate --pr <selector>` (GitHub) — the canonical CLI merge-gate command; `pass`/`pass-pr` remain as aliases.

## [1.5.0] - 2026-06-10

### Fixed

- Risk classification precision: whole-token concept matching ('fix payload parsing' no longer flags money flow), singularized path tokens (`roles.guard.ts` now flags auth/security), basename-pattern secret detection (`dev.environments.ts` and docs no longer hard-fail the gate), and gate-mode filtering so test/doc-only changes stop drawing risk warnings.
- `repoctx pr` now uses the shared risk classifier — `pr` and `pass` agree on the same diff.
- Impact ranking: one stray concept can no longer halve every non-matching file's score.
- Index cache: atomic writes, warn-once on write failure, bounded in-process memo for repeated MCP calls.
- `init` adds `.dev-context/` to the target repo's `.gitignore`, so first-call index caching no longer dirties working trees.

### Changed

- MCP transport slimmed: compact JSON (no pretty-printing), duplicate `structuredContent` removed, `includeMarkdown` returns the markdown report as the response text; `repo_inspect`/`context_pack` payloads gate file lists, script bodies, and per-file evidence behind opt-ins. Tools declare `readOnlyHint` annotations; the review-family tool descriptions disambiguate each other; `repo_search` hints at `repo_index` when the catalog is empty.
- `agent-tools` catalog is derived from the MCP tools array (was a drifted hand-maintained copy), with a parity test.
- README leads with the deterministic merge gates; code-map docs reflect the multi-language extractors.

### Added

- `doctor` checks for the `gh` CLI (required by `pr_merge_readiness`).
- 72 new tests (242 total): gate fallback paths, cache staleness/corruption/atomicity, parser-path coverage, and pins on every fixed false positive/negative.

## [1.4.3] - 2026-06-10

### Note

- Published automatically by the tag-triggered release workflow when the `v1.4.3` tag landed; 1.5.0 followed minutes later with the review-findings batch.

### Fixed

- **Critical:** the npm-installed `repoctx` / `dev-context` bins were silent no-ops in 1.4.0–1.4.2. The invoked-as-script guard compared `import.meta.url` (realpath-resolved by the ESM loader) against `argv[1]` (the npm bin symlink), so `main()` never ran via `npx` or `npm i -g`. Realpaths are now compared on both sides.
- MCP server no longer responds to JSON-RPC notifications (e.g. `notifications/cancelled`); previously unknown notifications received a spec-violating `-32601` error with no id.
- MCP `initialize` now negotiates `protocolVersion`: a supported client revision (2024-11-05, 2025-03-26, 2025-06-18) is echoed back instead of always forcing the latest.

### Added

- Packed-tarball smoke test (`npm run smoke:tarball`, part of `npm run smoke` / the quality gate): packs the real tarball, installs it into a temp project, and runs the installed bin — the seam that let the broken bins ship undetected.

## [1.4.2] - 2026-06-10

### Added

- README: demo GIF.
- `version` lifecycle hook: `npm version` now syncs `server.json` with `package.json` automatically, so `version:check` can no longer block a release.

### Changed

- README badges use semantic colors instead of brand red.

### Note

- 1.4.1 was tagged but never published: `version:check` correctly blocked the npm publish because `server.json` still said 1.4.0. Superseded by 1.4.2.

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
