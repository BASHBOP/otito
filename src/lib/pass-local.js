// Local merge-readiness gate ported from pullpass/internal/local/evaluate.go.
// Given a repo + base ref, runs a battery of deterministic checks (changed
// files, secret safety, risk review, release discipline, validation commands,
// dependency audit hint, review-state placeholder) and rolls them up into a
// single PASS/WARN/FAIL verdict.

/// <reference types="node" />

import fs from "node:fs";
import path from "node:path";
import { runCommand } from "./tools.js";
import { matchRiskPaths, matchSecretPaths, classifyPath, glyphFor } from "./risk-paths.js";
import { checkRelease } from "./release-check.js";
import { aggregateVerdict, normalizeGovernance, normalizeProfile, policyCheck, STATUS } from "./policy.js";
import { estimateTokens } from "./tokens.js";

/**
 * A single check produced by the local/PR merge-readiness gates.
 * @typedef {Object} Check
 * @property {string} name
 * @property {Verdict} status
 * @property {string} summary
 * @property {string[]} [details]
 */

/**
 * Rolled-up gate result. Mirrors the STATUS values from policy.js.
 * @typedef {"PASS" | "WARN" | "FAIL"} Verdict
 */

const passEngineVersion = 1;

/**
 * @param {string} repoPath
 * @param {{ policy?: unknown, governance?: unknown, base?: string, request?: string }} [options]
 */
export function evaluateLocal(repoPath, options = {}) {
  const profile = normalizeProfile(options.policy);
  const governance = normalizeGovernance(options.governance);

  const root = gitRoot(repoPath);
  const base = options.base ?? defaultBase(root);
  const files = changedFiles(root, base);

  /** @param {string} file */
  const baseContent = (file) => gitShowContent(root, base, file);
  const checks = [
    changedFilesCheck(files),
    secretCheck(files),
    riskCheck(files),
    checkRelease(root, files, { baseContent, governance }),
    validationCommandsCheck(root),
  ];
  const audit = dependencyAuditCheck(root);
  if (audit) checks.push(audit);
  const drift = contractDriftCheck(root);
  if (drift) checks.push(drift);
  checks.push(localReviewCheck());
  checks.push(policyCheck({ profile, governance, files, checks, remote: false }));

  const verdict = aggregateVerdict(checks);

  /** @type {Record<string, unknown> & { tokenEstimate?: { fullJson: number } }} */
  const data = {
    ok: true,
    generatedAt: new Date().toISOString(),
    passEngineVersion,
    verdict,
    repo: { root, name: path.basename(root) },
    base,
    request: options.request ?? "",
    policy: profile,
    governance,
    changedFiles: files,
    contextEvidence: contextEvidence(base, options.request),
    checks,
  };
  data.tokenEstimate = { fullJson: estimateTokens(data) };
  return data;
}

/**
 * @param {string} root
 * @param {string} base
 * @returns {string[]}
 */
export function changedFiles(root, base) {
  const tracked = runGit(root, ["diff", "--name-only", "--relative", base, "--"]);
  const staged = runGit(root, ["diff", "--cached", "--name-only", "--relative", "--"]);
  const untracked = runGit(root, ["ls-files", "--others", "--exclude-standard"]);
  const seen = new Set();
  for (const list of [tracked, staged, untracked]) {
    for (const file of list) if (file) seen.add(file);
  }
  return [...seen].sort();
}

/**
 * @param {string} repoPath
 * @returns {string}
 */
export function gitRoot(repoPath) {
  const lines = runGit(repoPath, ["rev-parse", "--show-toplevel"]);
  if (lines.length === 0) throw new Error("not a git repository");
  return lines[0];
}

/**
 * @param {string} cwd
 * @param {string[]} args
 * @returns {string[]}
 */
function runGit(cwd, args) {
  const result = runCommand("git", args, { cwd });
  if (!result.ok) {
    const text = (result.stderr || result.stdout || "").trim();
    throw new Error(`git ${args.join(" ")}: ${text || "command failed"}`);
  }
  return result.stdout
    .split("\n")
    .map((/** @type {string} */ line) => line.trim())
    .filter(Boolean);
}

// Content of `file` at the `base` ref, or null when the ref or path is absent.
// Non-throwing so release discipline can fall back to head-only inspection.
/**
 * @param {string} cwd
 * @param {string} base
 * @param {string} file
 * @returns {string | null}
 */
export function gitShowContent(cwd, base, file) {
  const result = runCommand("git", ["show", `${base}:${file}`], { cwd });
  return result.ok ? result.stdout : null;
}

/** @param {string} root */
function defaultBase(root) {
  for (const candidate of ["origin/main", "origin/master", "main", "master"]) {
    const probe = runCommand("git", ["rev-parse", "--verify", candidate], { cwd: root });
    if (probe.ok) return candidate;
  }
  return "HEAD";
}

/**
 * @param {string[]} files
 * @returns {Check}
 */
function changedFilesCheck(files) {
  if (files.length === 0) {
    return { name: "Changed files", status: STATUS.warn, summary: "No changed files found against the selected base." };
  }
  return {
    name: "Changed files",
    status: STATUS.pass,
    summary: `${files.length} changed file${files.length === 1 ? "" : "s"} found.`,
    details: files.slice(0, 20),
  };
}

/**
 * @param {string[]} files
 * @returns {Check}
 */
function secretCheck(files) {
  const matches = matchSecretPaths(files);
  if (matches.length > 0) {
    return { name: "Secret safety", status: STATUS.fail, summary: "Potential secret or environment file changed.", details: matches.slice(0, 20) };
  }
  return { name: "Secret safety", status: STATUS.pass, summary: "No obvious secret file changes found." };
}

/**
 * @param {string[]} files
 * @returns {Check}
 */
function riskCheck(files) {
  // Gate mode: ignore test files and documentation. A `checkout.spec.ts` test
  // or a `git-checkout-guide.md` doc is risk-adjacent for ranking purposes but
  // must not, on its own, force an explicit-review warning at merge time.
  const matches = matchRiskPaths(files, { gate: true });
  if (matches.length > 0) {
    return {
      name: "Risk review",
      status: STATUS.warn,
      summary: "Risk-sensitive files changed; maintainer review should be explicit.",
      details: matches.slice(0, 20),
    };
  }
  return { name: "Risk review", status: STATUS.pass, summary: "No obvious risk-sensitive file paths changed." };
}

/**
 * @param {string} root
 * @returns {Check}
 */
function validationCommandsCheck(root) {
  const commands = inferValidationCommands(root);
  if (commands.length === 0) {
    return { name: "Validation commands", status: STATUS.warn, summary: "No obvious validation command found; define tests before relying on this gate." };
  }
  return { name: "Validation commands", status: STATUS.pass, summary: "Validation commands are available.", details: commands };
}

/**
 * @param {string} root
 * @returns {Check | null}
 */
function dependencyAuditCheck(root) {
  if (!exists(path.join(root, "package.json"))) return null;
  const commands = dependencyAuditCommands(root);
  if (!hasPackageLockfile(root)) {
    return {
      name: "Dependency audit",
      status: STATUS.warn,
      summary: "Package manifest found without a supported lockfile; audit results may not be reproducible.",
      details: commands,
    };
  }
  return { name: "Dependency audit", status: STATUS.pass, summary: "Dependency audit commands are available.", details: commands };
}

/** @returns {Check} */
function localReviewCheck() {
  return {
    name: "Review state",
    status: STATUS.warn,
    summary: "Local mode cannot verify approvals, CODEOWNERS, status checks, or unresolved conversations yet.",
  };
}

// Optional FE↔BE contract-drift gate, powered by tieline
// (https://github.com/nugehs/tieline). Runs only when a tieline config is
// discoverable AND the binary resolves; otherwise it skips silently so the gate
// never hard-depends on tieline being installed.
/**
 * @param {string} root
 * @returns {Check | null}
 */
function contractDriftCheck(root) {
  const cfg = findTielineConfig(root);
  if (!cfg) return null;
  const cwd = path.dirname(cfg);
  const bin = resolveTielineBin(cwd, root);
  if (!bin) {
    return {
      name: "Contract drift",
      status: STATUS.warn,
      summary: "tieline config found but the tieline binary could not be resolved — install @nugehs/tieline to enable this gate.",
      details: [cfg],
    };
  }
  const res = runCommand(bin, ["check", "--json", "--no-fail", "--config", cfg], { cwd, timeout: 60000 });
  let parsed;
  try {
    parsed = JSON.parse(res.stdout);
  } catch {
    return null; // tieline unavailable or output unparseable — skip, never break the gate
  }
  const drift = parsed?.totals?.drift ?? 0;
  if (drift === 0) {
    return { name: "Contract drift", status: STATUS.pass, summary: "No frontend↔backend contract drift (tieline)." };
  }
  const details = (parsed.drift ?? [])
    .slice(0, 10)
    .map(
      (/** @type {{ method: string, path: string, name: string, hint?: string }} */ d) =>
        `${d.method} ${d.path} (${d.name}) — ${d.hint ?? "no matching backend route"}`,
    );
  return {
    name: "Contract drift",
    status: STATUS.warn,
    summary: `${drift} frontend call(s) hit a backend route that does not exist (tieline).`,
    details,
  };
}

/**
 * @param {string} root
 * @returns {string | null}
 */
function findTielineConfig(root) {
  const envCfg = process.env.REPOCTX_TIELINE_CONFIG;
  if (envCfg && exists(envCfg)) return path.resolve(envCfg);
  let dir = root;
  for (let i = 0; i < 3; i++) {
    const candidate = path.join(dir, "tieline.config.json");
    if (exists(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * @param {string} cwd
 * @param {string} root
 * @returns {string | null}
 */
function resolveTielineBin(cwd, root) {
  for (const base of [cwd, root]) {
    const local = path.join(base, "node_modules", ".bin", "tieline");
    if (exists(local)) return local;
  }
  const probe = runCommand("tieline", ["--help"], { cwd, timeout: 10000 });
  if (probe.ok || /tieline/i.test(`${probe.stdout}${probe.stderr}`)) return "tieline";
  return null;
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function dependencyAuditCommands(root) {
  switch (packageRunner(root)) {
    case "yarn":
      return ["yarn npm audit --environment production --recursive --severity critical", "yarn npm audit --environment production --recursive"];
    case "pnpm":
      return ["pnpm audit --prod --audit-level critical", "pnpm audit --prod"];
    default:
      return ["npm audit --omit=dev --audit-level=critical", "npm audit --omit=dev"];
  }
}

/** @param {string} root */
function hasPackageLockfile(root) {
  return ["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock"].some((name) => exists(path.join(root, name)));
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function inferValidationCommands(root) {
  if (exists(path.join(root, "package.json"))) {
    const commands = packageValidationCommands(root);
    if (commands.length > 0) return commands;
  }
  if (exists(path.join(root, "go.mod"))) return ["go test ./..."];
  if (exists(path.join(root, "pyproject.toml")) && isDir(path.join(root, "tests"))) return ["PYTHONPATH=src python3 -m unittest discover -s tests"];
  if (isDir(path.join(root, "tests"))) return ["python3 -m unittest discover -s tests"];
  return [];
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function packageValidationCommands(root) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  } catch {
    return [];
  }
  const runner = packageRunner(root);
  const preferred = ["ci", "quality", "test", "lint", "typecheck", "check:type", "tsc:check", "type-check"];
  const scripts = parsed?.scripts ?? {};
  const commands = [];
  for (const name of preferred) {
    if (scripts[name]) commands.push(packageScriptCommand(runner, name));
  }
  const deps = { ...(parsed?.dependencies ?? {}), ...(parsed?.devDependencies ?? {}) };
  if (exists(path.join(root, "tsconfig.json")) && deps.typescript && !preferred.some((name) => name !== "test" && name !== "lint" && scripts[name])) {
    commands.push(typeScriptFallback(runner));
  }
  return commands;
}

/**
 * @param {string} root
 * @returns {"pnpm" | "yarn" | "npm"}
 */
function packageRunner(root) {
  if (exists(path.join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (exists(path.join(root, "yarn.lock"))) return "yarn";
  return "npm";
}

/**
 * @param {string} runner
 * @param {string} name
 * @returns {string}
 */
function packageScriptCommand(runner, name) {
  if (runner === "yarn") return `yarn ${name}`;
  if (runner === "pnpm") return name === "test" ? "pnpm test" : `pnpm run ${name}`;
  return name === "test" ? "npm test" : `npm run ${name}`;
}

/**
 * @param {string} runner
 * @returns {string}
 */
function typeScriptFallback(runner) {
  if (runner === "yarn") return "yarn tsc --noEmit";
  if (runner === "pnpm") return "pnpm exec tsc --noEmit";
  return "npm exec --package typescript -- tsc --noEmit";
}

/**
 * @param {string} base
 * @param {string} [request]
 * @returns {string[]}
 */
function contextEvidence(base, request) {
  const quoted = JSON.stringify(request && request.trim() ? request : "review this change");
  return [`repoctx impact . ${quoted} --json`, `repoctx pr . --base ${base} --out .dev-context/pr-review.md`];
}

/** @param {string} filePath */
function exists(filePath) {
  try {
    fs.statSync(filePath);
    return true;
  } catch {
    return false;
  }
}

/** @param {string} filePath */
function isDir(filePath) {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

// Fancy + markdown renderers live next to the engine because they share the
// check shape and glyph mapping.

const STATUS_TO_RENDER = {
  PASS: "pass",
  WARN: "warn",
  FAIL: "fail",
};

/**
 * @typedef {Object} PassData
 * @property {Verdict} verdict
 * @property {{ root: string, name: string }} repo
 * @property {string} base
 * @property {string} policy
 * @property {string} governance
 * @property {string[]} changedFiles
 * @property {string[]} contextEvidence
 * @property {Check[]} checks
 */

/**
 * @param {PassData} data
 * @param {(options: object) => any} rendererFactory
 * @returns {string}
 */
export function formatPassTerminal(data, rendererFactory) {
  const renderer = rendererFactory({});
  const lines = [];
  const sub = [
    { text: data.repo.root, glyph: "📂" },
    { text: `${data.base} · ${data.changedFiles.length} changed file${data.changedFiles.length === 1 ? "" : "s"} · policy: ${data.policy}`, glyph: "🔀" },
  ];
  lines.push(renderer.header({ text: "repoctx pass · merge readiness", glyph: "📋" }, sub));
  lines.push("");

  for (const check of data.checks) {
    const status = STATUS_TO_RENDER[check.status] ?? "info";
    const details = (check.details ?? []).slice(0, 10).map((detail) => decorateDetail(detail, renderer.emoji));
    lines.push(renderer.statusLine(status, check.name, check.summary, details));
  }

  lines.push("");
  const blocked = data.checks.find((entry) => entry.status === STATUS.fail);
  const warning = data.checks.find((entry) => entry.status === STATUS.warn);
  lines.push(
    renderer.verdict({
      verdict: data.verdict,
      blockedBy: blocked ? blocked.name : undefined,
      nextStep: nextStepFor(data, blocked, warning),
    }),
  );

  lines.push("");
  lines.push(`  ${renderer.emoji ? "💡" : "[i]"}  Context evidence:`);
  for (const command of data.contextEvidence) lines.push(`     ${renderer.emoji ? "•" : "-"} ${command}`);

  return lines.join("\n");
}

/**
 * @param {string} detail
 * @param {boolean} emoji
 * @returns {string}
 */
function decorateDetail(detail, emoji) {
  if (!emoji) return detail;
  const flags = classifyPath(detail);
  const glyph = flags.length ? glyphFor(flags[0]) : "";
  return glyph ? `${glyph}  ${detail}` : detail;
}

/**
 * @param {PassData} data
 * @param {Check | undefined} blocked
 * @param {Check | undefined} warning
 * @returns {string}
 */
function nextStepFor(data, blocked, warning) {
  if (blocked) {
    if (blocked.name === "Secret safety") return "remove or rotate the affected file before merge";
    if (blocked.name === "Release discipline") return "fix version metadata before bumping";
    if (blocked.name === "Policy profile") return "satisfy the missing policy controls";
    return "address the blocking check";
  }
  if (warning) {
    if (warning.name === "Risk review") return "record the maintainer decision before merge";
    if (warning.name === "Review state") return "verify the missing review evidence";
    return "review the warning before merge";
  }
  return data.changedFiles.length === 0 ? "no changes vs base" : "ready to merge";
}

/**
 * @param {PassData} data
 * @returns {string}
 */
export function formatPassMarkdown(data) {
  const lines = [
    `# repoctx pass: ${data.repo.name}`,
    "",
    `Verdict: **${data.verdict}**`,
    `Repository: \`${data.repo.root}\``,
    `Base: \`${data.base}\``,
    `Policy: \`${data.policy}\``,
    `Governance: \`${data.governance}\``,
    "",
    "## Context Evidence",
    "",
    ...data.contextEvidence.map((command) => `- \`${command}\``),
    "",
    "## Changed Files",
    "",
    ...(data.changedFiles.length ? data.changedFiles.map((file) => `- \`${file}\``) : ["- (no changes vs base)"]),
    "",
    "## Checks",
    "",
  ];
  for (const check of data.checks) {
    lines.push(`### ${check.status}  ·  ${check.name}`);
    lines.push("");
    lines.push(check.summary);
    if (check.details && check.details.length) {
      lines.push("");
      for (const detail of check.details) lines.push(`- ${detail}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
