/// <reference types="node" />
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectRepo } from "./repo.js";
import { generateCodeMap } from "./code-map.js";
import { generateHarness } from "./harness.js";
import { generateContextPack } from "./context-engine.js";
import { classifyPath, conceptsFromQuery, isGateRiskPath, isSecretPath } from "./risk-paths.js";
import { runCommand } from "./tools.js";

/**
 * Options for the token-savings eval.
 * @typedef {object} EvalOptions
 * @property {string} [query]
 * @property {number} [naiveFileCap]
 */

/**
 * Outcome of a single safeRun-wrapped probe.
 * @typedef {object} ProbeResult
 * @property {boolean} ok
 * @property {number} bytes
 * @property {string} [error]
 */

/**
 * A per-task token-savings result.
 * @typedef {object} TaskResult
 * @property {string} name
 * @property {string} description
 * @property {boolean} ok
 * @property {string} [error]
 * @property {number} otitoBytes
 * @property {number} otitoTokens
 * @property {number} naiveBytes
 * @property {number} naiveTokens
 * @property {number} savedTokens
 * @property {number} savedPct
 * @property {number} [mapFileCount]
 * @property {number} [naiveFileCount]
 */

/**
 * A single retrieval test case from the corpus.
 * @typedef {object} RetrievalCase
 * @property {string} name
 * @property {string} query
 * @property {string} [repoFixture]
 * @property {string[]} [repoFixtures]
 * @property {string[]} [expectedPrimary]
 * @property {string[]} [expectedAnyOf]
 */

/**
 * A single risk test case from the corpus.
 * @typedef {object} RiskCase
 * @property {string} name
 * @property {string} [mode] - "query" | "path" | "gate" | "secret".
 * @property {string} [query]
 * @property {string} [path]
 * @property {string[]} [expectedConcepts]
 * @property {string[]} [notExpectedConcepts]
 */

/**
 * Retrieval/risk pass thresholds.
 * @typedef {object} CorpusThresholds
 * @property {{ precisionAtK?: number, recallAtK?: number, mrr?: number }} [retrieval]
 * @property {{ accuracy?: number }} [risk]
 */

/**
 * Parsed accuracy corpus document.
 * @typedef {object} Corpus
 * @property {number} [k]
 * @property {Record<string, string>} [fixtureRoots]
 * @property {RetrievalCase[]} retrieval
 * @property {RiskCase[]} risk
 * @property {CorpusThresholds} [thresholds]
 * @property {HarnessExecutionCase[]} [harnessExecution]
 */

/**
 * A fixture-backed assertion that an inferred harness command is executable.
 * @typedef {object} HarnessExecutionCase
 * @property {string} name
 * @property {string} repoFixture
 * @property {HarnessExecutionExpectation[]} commands
 */

/**
 * @typedef {object} HarnessExecutionExpectation
 * @property {"install"|"test"|"typecheck"|"build"} kind
 * @property {"setup"|"validate"} group
 * @property {string} command
 * @property {string} [script]
 */

/**
 * @typedef {object} HarnessExecutionResult
 * @property {"install"|"test"|"typecheck"|"build"} kind
 * @property {string} command
 * @property {boolean} inferred
 * @property {boolean} executed
 * @property {number|null} [status]
 * @property {boolean} pass
 * @property {string} [error]
 * @property {string} [output]
 */

/**
 * @typedef {object} ScoredHarnessExecutionCase
 * @property {string} name
 * @property {"harness_execution"} type
 * @property {string} fixture
 * @property {HarnessExecutionResult[]} commands
 * @property {boolean} pass
 * @property {string} [error]
 */

/**
 * Retrieval scoring metrics for one case (null fields for pure-fallback cases).
 * @typedef {object} RetrievalMetrics
 * @property {number|null} precisionAtK
 * @property {number|null} recallAtK
 * @property {number|null} mrr
 * @property {number} hits
 * @property {number} relevant
 */

/**
 * A scored retrieval case.
 * @typedef {object} ScoredRetrievalCase
 * @property {string} name
 * @property {"retrieval"} type
 * @property {string} query
 * @property {string[]} fixtures
 * @property {string[]} expectedPrimary
 * @property {string[]} expectedAnyOf
 * @property {string[]} ranked
 * @property {string[]} related
 * @property {boolean} pass
 * @property {string} [error]
 * @property {RetrievalMetrics} metrics
 */

/**
 * A scored risk case.
 * @typedef {object} ScoredRiskCase
 * @property {string} name
 * @property {"risk"} type
 * @property {string} mode
 * @property {string|undefined} input
 * @property {string[]} expectedConcepts
 * @property {string[]} notExpectedConcepts
 * @property {string[]} actualConcepts
 * @property {string[]} missing
 * @property {string[]} leaked
 * @property {boolean} pass
 * @property {string} [error]
 */

const DEFAULTS = {
  query: "understand and refactor this codebase",
  naiveFileCap: 40,
};

const SOURCE_EXTS = new Set([
  ".js",
  ".ts",
  ".jsx",
  ".tsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".cs",
  ".vb",
  ".aspx",
  ".master",
  ".cshtml",
  ".razor",
  ".php",
  ".scala",
  ".clj",
  ".ex",
  ".exs",
  ".html",
  ".vue",
  ".svelte",
  ".astro",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".config",
]);

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  ".otito",
  "bin",
  "obj",
  "coverage",
  "site",
  "vendor",
  ".venv",
  "__pycache__",
  "target",
  ".cache",
  ".turbo",
]);

const CHARS_PER_TOKEN = 4;

/**
 * @param {string} repoPath
 * @param {EvalOptions} [options]
 */
export function runEval(repoPath, options = {}) {
  const root = path.resolve(repoPath);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`repo not found: ${root}`);
  }
  const opts = { ...DEFAULTS, ...options };

  const tasks = [runRepoOverview(root), runCodeMap(root, opts), runHarness(root), runContextPack(root, opts)];

  const totals = aggregate(tasks);

  const data = {
    ok: true,
    generatedAt: new Date().toISOString(),
    evalVersion: 1,
    repo: { root, name: path.basename(root) },
    method: `ceil(characters / ${CHARS_PER_TOKEN})`,
    query: opts.query,
    naiveFileCap: opts.naiveFileCap,
    tasks,
    totals,
  };

  return { data, markdown: formatEvalMarkdown(data) };
}

/**
 * @param {string} root
 * @returns {TaskResult}
 */
function runRepoOverview(root) {
  const otito = safeRun(() => {
    const result = inspectRepo(root);
    return JSON.stringify(result);
  });

  let naiveBytes = naiveListing(root).length;
  for (const f of ["README.md", "package.json", "pyproject.toml", "Cargo.toml", "go.mod", "Web.config"]) {
    const p = path.join(root, f);
    if (isFile(p)) naiveBytes += statSize(p);
  }

  return makeTaskResult("repo_overview", "Identify what this repo is", otito, naiveBytes);
}

/**
 * @param {string} root
 * @param {{ naiveFileCap: number }} opts
 * @returns {TaskResult}
 */
function runCodeMap(root, opts) {
  /** @type {number|undefined} */
  let mapFileCount;
  const otito = safeRun(() => {
    const map = generateCodeMap(root);
    mapFileCount = (map.files ?? []).length;
    return JSON.stringify(map);
  });

  const sources = listSourceFiles(root).slice(0, opts.naiveFileCap);
  const naiveBytes = sources.reduce((sum, p) => sum + statSize(p), 0);

  return makeTaskResult("code_map", `Map the source (naive caps at ${opts.naiveFileCap} files)`, otito, naiveBytes, {
    mapFileCount,
    naiveFileCount: sources.length,
  });
}

/**
 * @param {string} root
 * @returns {TaskResult}
 */
function runHarness(root) {
  const otito = safeRun(() => {
    const result = generateHarness(root);
    return result.markdown ?? JSON.stringify(result.data);
  });

  let naiveBytes = 0;
  const candidates = ["package.json", "Makefile", "justfile", "pyproject.toml", "Cargo.toml", "go.mod", "Gemfile", "WebProject.csproj", "packages.config"];
  for (const f of candidates) {
    const p = path.join(root, f);
    if (isFile(p)) naiveBytes += statSize(p);
  }
  const ciDir = path.join(root, ".github", "workflows");
  if (isDir(ciDir)) {
    for (const f of readDirSafe(ciDir)) {
      const p = path.join(ciDir, f);
      if (isFile(p)) naiveBytes += statSize(p);
    }
  }

  return makeTaskResult("harness", "Identify setup/validation/runtime commands", otito, naiveBytes);
}

/**
 * @param {string} root
 * @param {{ query: string, naiveFileCap: number }} opts
 * @returns {TaskResult}
 */
function runContextPack(root, opts) {
  const otito = safeRun(() => {
    const result = generateContextPack(opts.query, { path: root });
    return result.markdown ?? JSON.stringify(result.data ?? result);
  });

  const sources = listSourceFiles(root).slice(0, opts.naiveFileCap);
  const naiveBytes = sources.reduce((sum, p) => sum + statSize(p), 0);

  return makeTaskResult("context_pack", `Task-aware context for: "${opts.query}"`, otito, naiveBytes);
}

/**
 * @param {() => string} fn
 * @returns {ProbeResult}
 */
function safeRun(fn) {
  try {
    const text = fn();
    return { ok: true, bytes: Buffer.byteLength(text, "utf8") };
  } catch (err) {
    return { ok: false, bytes: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * @param {string} name
 * @param {string} description
 * @param {ProbeResult} otito
 * @param {number} naiveBytes
 * @param {{ mapFileCount?: number, naiveFileCount?: number }} [extra]
 * @returns {TaskResult}
 */
function makeTaskResult(name, description, otito, naiveBytes, extra = {}) {
  const otitoTokens = Math.ceil(otito.bytes / CHARS_PER_TOKEN);
  const naiveTokens = Math.ceil(naiveBytes / CHARS_PER_TOKEN);
  const savedTokens = naiveTokens - otitoTokens;
  const savedPct = naiveBytes > 0 ? Math.round(((naiveBytes - otito.bytes) / naiveBytes) * 100) : 0;
  return {
    name,
    description,
    ok: otito.ok,
    error: otito.error,
    otitoBytes: otito.bytes,
    otitoTokens,
    naiveBytes,
    naiveTokens,
    savedTokens,
    savedPct,
    ...extra,
  };
}

/**
 * @param {TaskResult[]} tasks
 */
function aggregate(tasks) {
  const otitoBytes = tasks.reduce((s, t) => s + t.otitoBytes, 0);
  const naiveBytes = tasks.reduce((s, t) => s + t.naiveBytes, 0);
  const otitoTokens = Math.ceil(otitoBytes / CHARS_PER_TOKEN);
  const naiveTokens = Math.ceil(naiveBytes / CHARS_PER_TOKEN);
  return {
    otitoBytes,
    naiveBytes,
    otitoTokens,
    naiveTokens,
    savedTokens: naiveTokens - otitoTokens,
    savedPct: naiveBytes > 0 ? Math.round(((naiveBytes - otitoBytes) / naiveBytes) * 100) : 0,
  };
}

/**
 * @param {string} root
 * @returns {string}
 */
function naiveListing(root) {
  /** @type {string[]} */
  const lines = [];
  walk(root, root, lines, 0);
  return lines.join("\n");
}

/**
 * @param {string} start
 * @param {string} dir
 * @param {string[]} lines
 * @param {number} depth
 */
function walk(start, dir, lines, depth) {
  if (depth > 4) return;
  const entries = readDirEnts(dir);
  for (const ent of entries) {
    if (IGNORED_DIRS.has(ent.name)) continue;
    if (depth === 0 && ent.name.startsWith(".")) continue;
    const full = path.join(dir, ent.name);
    const rel = path.relative(start, full);
    lines.push(rel + (ent.isDirectory() ? "/" : ""));
    if (ent.isDirectory()) walk(start, full, lines, depth + 1);
  }
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function listSourceFiles(root) {
  /** @type {string[]} */
  const out = [];
  walkFiles(root, out);
  out.sort();
  return out;
}

/**
 * @param {string} dir
 * @param {string[]} out
 */
function walkFiles(dir, out) {
  for (const ent of readDirEnts(dir)) {
    if (IGNORED_DIRS.has(ent.name)) continue;
    if (ent.name.startsWith(".")) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkFiles(full, out);
    else if (SOURCE_EXTS.has(path.extname(ent.name).toLowerCase())) out.push(full);
  }
}

/**
 * @param {string} dir
 * @returns {import('node:fs').Dirent[]}
 */
function readDirEnts(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
function readDirSafe(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * @param {string} p
 * @returns {boolean}
 */
function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * @param {string} p
 * @returns {boolean}
 */
function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * @param {string} p
 * @returns {number}
 */
function statSize(p) {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}

/**
 * @param {{ repo: { name: string }, generatedAt: string, evalVersion: number, method: string, query: string, naiveFileCap: number, tasks: TaskResult[], totals: ReturnType<typeof aggregate> }} data
 * @returns {string}
 */
export function formatEvalMarkdown(data) {
  const lines = [
    `# otito Eval: ${data.repo.name}`,
    "",
    `Generated: ${data.generatedAt}`,
    `Eval version: ${data.evalVersion}`,
    `Token method: ${data.method}`,
    `Query (for context_pack): "${data.query}"`,
    `Naive file cap: ${data.naiveFileCap}`,
    "",
    "## Per-task",
    "",
    "| Task | otito tokens | naive tokens | saved | saved% | coverage | ok |",
    "|---|---:|---:|---:|---:|:---:|:---:|",
    ...data.tasks.map(
      (t) => `| ${t.name} | ${t.otitoTokens} | ${t.naiveTokens} | ${t.savedTokens} | ${t.savedPct}% | ${formatCoverage(t)} | ${t.ok ? "yes" : "no"} |`,
    ),
    "",
    "## Totals",
    "",
    `- otito: **${data.totals.otitoTokens} tokens** (${data.totals.otitoBytes} bytes)`,
    `- naive:   **${data.totals.naiveTokens} tokens** (${data.totals.naiveBytes} bytes)`,
    `- saved:   **${data.totals.savedTokens} tokens (${data.totals.savedPct}%)**`,
    "",
    "_Naive is a deterministic JS-side approximation of what a grep+ls+read agent would absorb, not a live subagent transcript. Same approximation runs on every run, so deltas across builds are the trustworthy signal._",
    "",
    "_Coverage on `code_map` is `files_mapped / files_naive_would_read`. A high savings% with low coverage means otito is smaller because it understands less, not because it summarised better — fix the language adapter before celebrating._",
    "",
  ];
  return lines.join("\n");
}

/**
 * @param {TaskResult} t
 * @returns {string}
 */
function formatCoverage(t) {
  if (t.mapFileCount === undefined || t.naiveFileCount === undefined) return "-";
  return `${t.mapFileCount}/${t.naiveFileCount}`;
}

// ---------------------------------------------------------------------------
// Accuracy eval: retrieval precision/recall/MRR + risk classification.
//
// The token-savings eval above answers "is the pack smaller?". It does NOT
// answer "is the pack *right*?" — a randomly-ranked pack scores the same as a
// perfect one. This runner closes that gap: it runs generateContextPack against
// a labeled corpus and scores whether the files an agent actually needs land in
// primaryFiles, and it runs the risk classifier against encoded false
// positives/negatives so regressions in risk-paths.js surface here, in CI,
// rather than in production review output.
// ---------------------------------------------------------------------------

const evalDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(evalDir, "..", "..");
const defaultCorpusPath = path.join(repoRoot, "evals", "corpus.json");

/**
 * Run the accuracy corpus and return a scoreboard plus per-case detail.
 *
 * @param {object} [options]
 * @param {string} [options.corpusPath] absolute path to a corpus.json (defaults to evals/corpus.json)
 * @param {string} [options.repoRoot] root used to resolve corpus fixtureRoots (defaults to the otito repo root)
 * @returns {{ data: object, markdown: string }}
 */
export function runRetrievalEval(options = {}) {
  const corpusPath = options.corpusPath ? path.resolve(options.corpusPath) : defaultCorpusPath;
  const root = options.repoRoot ? path.resolve(options.repoRoot) : repoRoot;
  const corpus = loadCorpus(corpusPath);
  const k = Number.isInteger(corpus.k) && (corpus.k ?? 0) > 0 ? /** @type {number} */ (corpus.k) : 5;
  const fixtureRoots = corpus.fixtureRoots ?? {};

  const retrievalCases = (corpus.retrieval ?? []).map((testCase) => scoreRetrievalCase(testCase, { root, fixtureRoots, k }));
  const riskCases = (corpus.risk ?? []).map((testCase) => scoreRiskCase(testCase));

  const retrievalScore = aggregateRetrieval(retrievalCases);
  const riskScore = aggregateRisk(riskCases);

  const thresholds = corpus.thresholds ?? {};
  const checks = evaluateThresholds(retrievalScore, riskScore, thresholds);
  const passed = checks.every((check) => check.pass);

  const data = {
    ok: true,
    generatedAt: new Date().toISOString(),
    evalKind: "accuracy",
    corpusPath,
    k,
    counts: {
      retrieval: retrievalCases.length,
      risk: riskCases.length,
    },
    scoreboard: {
      retrieval: retrievalScore,
      risk: riskScore,
    },
    thresholds,
    checks,
    passed,
    exitCode: passed ? 0 : 1,
    cases: {
      retrieval: retrievalCases,
      risk: riskCases,
    },
  };

  return { data, markdown: formatRetrievalEvalMarkdown(data) };
}

// ---------------------------------------------------------------------------
// Harness execution eval.
//
// Accuracy eval proves that Otito retrieves the right source context and labels
// risk correctly. This runner proves a distinct claim: for reviewed, committed
// fixture repositories, the setup and validation commands Otito inferred can
// actually run. Fixtures are copied to a temp directory; no customer checkout
// is executed. Command lines are deliberately constrained to package-manager
// forms, and install lifecycle scripts are disabled.
// ---------------------------------------------------------------------------

/**
 * Run the fixture-backed harness execution corpus.
 *
 * @param {object} [options]
 * @param {string} [options.corpusPath] absolute path to a corpus.json (defaults to evals/corpus.json)
 * @param {string} [options.repoRoot] root used to resolve corpus fixtureRoots (defaults to the otito repo root)
 * @returns {{ data: object, markdown: string }}
 */
export function runHarnessExecutionEval(options = {}) {
  const corpusPath = options.corpusPath ? path.resolve(options.corpusPath) : defaultCorpusPath;
  const root = options.repoRoot ? path.resolve(options.repoRoot) : repoRoot;
  const corpus = loadCorpus(corpusPath);
  const fixtureRoots = corpus.fixtureRoots ?? {};
  const cases = corpus.harnessExecution;

  if (!Array.isArray(cases) || cases.length === 0) {
    throw new Error(`corpus must define a non-empty harnessExecution[] array: ${corpusPath}`);
  }

  const results = cases.map((testCase) => scoreHarnessExecutionCase(testCase, { root, fixtureRoots }));
  const commandCount = results.reduce((sum, result) => sum + result.commands.length, 0);
  const passedCommands = results.reduce((sum, result) => sum + result.commands.filter((command) => command.pass).length, 0);
  const passed = results.every((result) => result.pass);

  const data = {
    ok: true,
    generatedAt: new Date().toISOString(),
    evalKind: "harness-execution",
    corpusPath,
    counts: {
      fixtures: results.length,
      commands: commandCount,
      passedCommands,
    },
    passed,
    exitCode: passed ? 0 : 1,
    cases: results,
  };

  return { data, markdown: formatHarnessExecutionEvalMarkdown(data) };
}

/**
 * @param {HarnessExecutionCase} testCase
 * @param {{ root: string, fixtureRoots: Record<string, string> }} context
 * @returns {ScoredHarnessExecutionCase}
 */
function scoreHarnessExecutionCase(testCase, { root, fixtureRoots }) {
  if (!testCase?.name || !testCase.repoFixture || !Array.isArray(testCase.commands) || testCase.commands.length === 0) {
    throw new Error("each harnessExecution case needs name, repoFixture, and a non-empty commands[] array");
  }

  const source = resolveFixture(root, fixtureRoots, testCase.repoFixture);
  assertHarnessFixtureRoot(root, source, testCase.repoFixture);
  const temp = copyFixtureToTemp(source);
  /** @type {HarnessExecutionResult[]} */
  let commands = [];
  /** @type {string|undefined} */
  let error;

  try {
    const harness = generateHarness(temp.dir).data;
    commands = testCase.commands.map((expected) => runHarnessExecutionCommand(expected, harness.commands, temp.dir));
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  } finally {
    try {
      fs.rmSync(temp.dir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup; the temporary fixture has no durable state.
    }
  }

  return {
    name: testCase.name,
    type: "harness_execution",
    fixture: testCase.repoFixture,
    commands,
    pass: !error && commands.length === testCase.commands.length && commands.every((command) => command.pass),
    error,
  };
}

/**
 * Harness execution is deliberately limited to this project's committed eval
 * fixtures. A corpus may choose among them, but it cannot redirect execution
 * to an arbitrary repository through an absolute fixtureRoots entry.
 *
 * @param {string} root
 * @param {string} source
 * @param {string} fixtureName
 */
function assertHarnessFixtureRoot(root, source, fixtureName) {
  const fixtureBase = path.resolve(root, "evals", "fixtures");
  const relative = path.relative(fixtureBase, source);
  if (relative === "" || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`harness execution fixture "${fixtureName}" must be inside ${fixtureBase}`);
  }
}

/**
 * @param {HarnessExecutionExpectation} expected
 * @param {{ setup?: Array<{ command: string, script?: string }>, validate?: Array<{ command: string, script?: string }> }} inferred
 * @param {string} cwd
 * @returns {HarnessExecutionResult}
 */
function runHarnessExecutionCommand(expected, inferred, cwd) {
  const matchesGroup = expected.group === "setup" || expected.group === "validate";
  const candidate = matchesGroup ? (inferred[expected.group] ?? []).find((command) => command.command === expected.command) : undefined;
  const inferredMatch = Boolean(candidate) && (!expected.script || candidate?.script === expected.script);
  const base = {
    kind: expected.kind,
    command: expected.command,
    inferred: inferredMatch,
    executed: false,
    pass: false,
  };

  if (!inferredMatch) {
    return { ...base, error: "expected command was not inferred from the fixture harness" };
  }

  const parsed = parseFixtureCommand(expected.command);
  if (!parsed) {
    return { ...base, error: "command is outside the fixture execution allowlist" };
  }

  /** @type {NodeJS.ProcessEnv} */
  const env = {
    ...process.env,
    CI: "1",
    NO_UPDATE_NOTIFIER: "1",
    npm_config_audit: "false",
    npm_config_fund: "false",
  };
  if (expected.kind === "install") {
    env.npm_config_ignore_scripts = "true";
  }

  const result = runCommand(parsed.command, parsed.args, { cwd, env, timeout: 60000, maxBuffer: 1024 * 1024 });
  const output = clipCommandOutput(`${result.stdout}\n${result.stderr}`);
  return {
    ...base,
    executed: true,
    status: result.status,
    pass: result.ok,
    error: result.ok ? undefined : (result.error?.message ?? `command exited ${result.status ?? "without a status"}`),
    output: output || undefined,
  };
}

/**
 * Restrict fixture execution to normal Node package-manager invocation forms.
 * The package scripts themselves stay within the reviewed fixture copy; no
 * command supplied by an inspected customer repository is ever executed.
 *
 * @param {string} commandLine
 * @returns {{ command: string, args: string[] }|undefined}
 */
function parseFixtureCommand(commandLine) {
  const match = /^(npm|pnpm|yarn|bun) (install|ci|test|run [A-Za-z0-9:_-]+)$/.exec(commandLine);
  if (!match) return undefined;
  const parts = commandLine.split(" ");
  const command = parts.shift();
  return command ? { command: process.platform === "win32" && command === "npm" ? "npm.cmd" : command, args: parts } : undefined;
}

/**
 * @param {string} output
 * @returns {string}
 */
function clipCommandOutput(output) {
  const trimmed = output.trim();
  if (trimmed.length <= 2000) return trimmed;
  return `${trimmed.slice(0, 1997)}...`;
}

/**
 * @param {string} corpusPath
 * @returns {Corpus}
 */
function loadCorpus(corpusPath) {
  /** @type {string} */
  let raw;
  try {
    raw = fs.readFileSync(corpusPath, "utf8");
  } catch (err) {
    throw new Error(`corpus not found: ${corpusPath} (${err instanceof Error ? err.message : String(err)})`, { cause: err });
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`corpus is not valid JSON: ${corpusPath} (${err instanceof Error ? err.message : String(err)})`, { cause: err });
  }
  if (!Array.isArray(parsed.retrieval) || !Array.isArray(parsed.risk)) {
    throw new Error(`corpus must define retrieval[] and risk[] arrays: ${corpusPath}`);
  }
  return parsed;
}

// Resolve the fixtures named by a retrieval case to absolute directories, copy
// each into an isolated temp dir (so the committed fixtures are never mutated
// and the stale `.otito/index.json` they ship with — pinned to an old
// absolute root and an old cache version — is dropped so the map regenerates
// from the real files), run generateContextPack, then clean the temp dirs up.
/**
 * @param {RetrievalCase} testCase
 * @param {{ root: string, fixtureRoots: Record<string, string>, k: number }} context
 * @returns {ScoredRetrievalCase}
 */
function scoreRetrievalCase(testCase, { root, fixtureRoots, k }) {
  const fixtureNames = testCase.repoFixtures ?? (testCase.repoFixture ? [testCase.repoFixture] : []);
  if (fixtureNames.length === 0) {
    throw new Error(`retrieval case "${testCase.name}" must name repoFixture or repoFixtures`);
  }
  const multiRepo = fixtureNames.length > 1;

  /** @type {{ dir: string }[]} */
  const temps = [];
  /** @type {string[]} */
  let ranked = [];
  /** @type {string[]} */
  let relatedInPack = [];
  /** @type {string|undefined} */
  let error;
  try {
    const paths = fixtureNames.map((name) => {
      const source = resolveFixture(root, fixtureRoots, name);
      const temp = copyFixtureToTemp(source);
      temps.push(temp);
      return temp.dir;
    });
    const { data } = generateContextPack(testCase.query, { paths });
    // For multi-repo cases the labels are namespaced "<fixture>/<repo-path>",
    // resolved from each primary file's originating repo. For single-repo
    // cases the label is the plain repo-relative path.
    const label = (/** @type {{ path: string, repo?: { root?: string } }} */ file) =>
      multiRepo ? `${fixtureForPrimary(file, fixtureNames, paths)}/${file.path}` : file.path;
    ranked = data.primaryFiles.map(label);
    relatedInPack = data.relatedFiles.map(label);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  } finally {
    for (const temp of temps) {
      try {
        fs.rmSync(temp.dir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup; a leftover temp dir is harmless.
      }
    }
  }

  const expectedPrimary = testCase.expectedPrimary ?? [];
  const expectedAnyOf = testCase.expectedAnyOf ?? [];
  const topK = ranked.slice(0, k);

  const metrics = computeRetrievalMetrics(expectedPrimary, ranked, k);

  // A case passes when every required primary is in the top-k AND, when an
  // expectedAnyOf set is given, at least one of those appears anywhere in the
  // pack (primary OR related — these encode route<->client pairing and other
  // related-file expectations, which the engine surfaces under relatedFiles).
  // For pure-fallback cases (expectedPrimary empty) the bar is the anyOf hit.
  const pack = [...ranked, ...relatedInPack];
  const primarySatisfied = expectedPrimary.length === 0 || expectedPrimary.every((p) => topK.includes(p));
  const anyOfSatisfied = expectedAnyOf.length === 0 || expectedAnyOf.some((p) => pack.includes(p));
  const pass = !error && primarySatisfied && anyOfSatisfied;

  return {
    name: testCase.name,
    type: "retrieval",
    query: testCase.query,
    fixtures: fixtureNames,
    expectedPrimary,
    expectedAnyOf,
    ranked: topK,
    related: relatedInPack,
    pass,
    error,
    metrics,
  };
}

// generateContextPack returns repo.root for each primary file; map that back to
// the logical fixture name by matching the temp dir we copied it into.
/**
 * @param {{ repo?: { root?: string } }} file
 * @param {string[]} fixtureNames
 * @param {string[]} paths
 * @returns {string}
 */
function fixtureForPrimary(file, fixtureNames, paths) {
  const root = file.repo?.root;
  const index = paths.findIndex((dir) => dir === root);
  return index >= 0 ? fixtureNames[index] : fixtureNames[0];
}

// precision@k = relevant-in-top-k / returned-in-top-k. The denominator is the
// number of files the pack actually returned (capped at k), NOT k itself:
// otito packs are intentionally tiny (often 1-3 primary files), so dividing a
// single correct hit by a fixed k=5 would score a *perfect* one-file pack at
// 0.2 and punish precision for being concise. Dividing by what was returned
// answers the right question — "of the files it surfaced, how many mattered?".
// recall@k = relevant-in-top-k / total-relevant. MRR = 1 / rank-of-first-
// relevant (0 if none in top-k). When a case has no required primaries (pure
// fallback) the metrics are not meaningful, so they are reported as null and
// excluded from the aggregate.
/**
 * @param {string[]} expectedPrimary
 * @param {string[]} ranked
 * @param {number} k
 * @returns {RetrievalMetrics}
 */
function computeRetrievalMetrics(expectedPrimary, ranked, k) {
  if (expectedPrimary.length === 0) {
    return { precisionAtK: null, recallAtK: null, mrr: null, hits: 0, relevant: 0 };
  }
  const expected = new Set(expectedPrimary);
  const topK = ranked.slice(0, k);
  const hits = topK.filter((p) => expected.has(p)).length;
  const returned = topK.length;

  let firstRelevantRank = 0;
  for (let i = 0; i < topK.length; i += 1) {
    if (expected.has(topK[i])) {
      firstRelevantRank = i + 1;
      break;
    }
  }

  return {
    precisionAtK: returned === 0 ? 0 : hits / returned,
    recallAtK: hits / expectedPrimary.length,
    mrr: firstRelevantRank > 0 ? 1 / firstRelevantRank : 0,
    hits,
    relevant: expectedPrimary.length,
  };
}

/**
 * @param {ScoredRetrievalCase[]} cases
 */
function aggregateRetrieval(cases) {
  const scored = cases.filter((c) => c.metrics.precisionAtK !== null);
  /** @param {(c: ScoredRetrievalCase) => number|null} selector */
  const avg = (selector) => (scored.length === 0 ? 0 : scored.reduce((sum, c) => sum + (selector(c) ?? 0), 0) / scored.length);
  return {
    cases: cases.length,
    scoredCases: scored.length,
    passed: cases.filter((c) => c.pass).length,
    pAtK: round3(avg((c) => c.metrics.precisionAtK)),
    rAtK: round3(avg((c) => c.metrics.recallAtK)),
    mrr: round3(avg((c) => c.metrics.mrr)),
  };
}

// Risk cases assert the risk vocabulary against encoded false positives and
// negatives. `mode` selects which predicate the case exercises:
//   query  -> conceptsFromQuery(query)            (concept labels)
//   path   -> classifyPath(path)                  (concept labels)
//   gate   -> isGateRiskPath(path)                 (boolean -> ["gate"] | [])
//   secret -> isSecretPath(path)                   (boolean -> ["secret"] | [])
// expectedConcepts must all be present; notExpectedConcepts must all be absent.
/**
 * @param {RiskCase} testCase
 * @returns {ScoredRiskCase}
 */
function scoreRiskCase(testCase) {
  const mode = testCase.mode ?? "path";
  /** @type {string[]} */
  let actual = [];
  /** @type {string|undefined} */
  let error;
  try {
    actual = classifyRiskCase(mode, testCase);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const expected = testCase.expectedConcepts ?? [];
  const notExpected = testCase.notExpectedConcepts ?? [];
  const actualSet = new Set(actual);

  const missing = expected.filter((concept) => !actualSet.has(concept));
  const leaked = notExpected.filter((concept) => actualSet.has(concept));
  const pass = !error && missing.length === 0 && leaked.length === 0;

  return {
    name: testCase.name,
    type: "risk",
    mode,
    input: testCase.query ?? testCase.path,
    expectedConcepts: expected,
    notExpectedConcepts: notExpected,
    actualConcepts: actual,
    missing,
    leaked,
    pass,
    error,
  };
}

/**
 * @param {string} mode
 * @param {RiskCase} testCase
 * @returns {string[]}
 */
function classifyRiskCase(mode, testCase) {
  switch (mode) {
    case "query":
      return conceptsFromQuery(/** @type {string} */ (testCase.query));
    case "path":
      return classifyPath(/** @type {string} */ (testCase.path));
    case "gate":
      return isGateRiskPath(/** @type {string} */ (testCase.path)) ? ["gate"] : [];
    case "secret":
      return isSecretPath(/** @type {string} */ (testCase.path)) ? ["secret"] : [];
    default:
      throw new Error(`unknown risk case mode "${mode}" (expected query|path|gate|secret)`);
  }
}

/**
 * @param {ScoredRiskCase[]} cases
 */
function aggregateRisk(cases) {
  const passed = cases.filter((c) => c.pass).length;
  return {
    cases: cases.length,
    passed,
    accuracy: cases.length === 0 ? 0 : round3(passed / cases.length),
  };
}

/**
 * @param {ReturnType<typeof aggregateRetrieval>} retrievalScore
 * @param {ReturnType<typeof aggregateRisk>} riskScore
 * @param {CorpusThresholds} thresholds
 * @returns {{ metric: string, value: number, threshold: number, pass: boolean }[]}
 */
function evaluateThresholds(retrievalScore, riskScore, thresholds) {
  /** @type {{ metric: string, value: number, threshold: number, pass: boolean }[]} */
  const checks = [];
  const retrievalThresholds = thresholds.retrieval ?? {};
  const riskThresholds = thresholds.risk ?? {};

  /**
   * @param {string} metric
   * @param {number} value
   * @param {number|undefined|null} floor
   */
  const pushCheck = (metric, value, floor) => {
    if (floor === undefined || floor === null) return;
    checks.push({ metric, value, threshold: floor, pass: value >= floor });
  };

  pushCheck("retrieval.precisionAtK", retrievalScore.pAtK, retrievalThresholds.precisionAtK);
  pushCheck("retrieval.recallAtK", retrievalScore.rAtK, retrievalThresholds.recallAtK);
  pushCheck("retrieval.mrr", retrievalScore.mrr, retrievalThresholds.mrr);
  pushCheck("risk.accuracy", riskScore.accuracy, riskThresholds.accuracy);

  return checks;
}

/**
 * @param {string} root
 * @param {Record<string, string>} fixtureRoots
 * @param {string} name
 * @returns {string}
 */
function resolveFixture(root, fixtureRoots, name) {
  const rel = fixtureRoots[name] ?? name;
  const abs = path.isAbsolute(rel) ? rel : path.join(root, rel);
  if (!isDir(abs)) {
    throw new Error(`fixture "${name}" resolved to a missing directory: ${abs}`);
  }
  return abs;
}

/**
 * @param {string} source
 * @returns {{ dir: string }}
 */
function copyFixtureToTemp(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "otito-eval-fix-"));
  for (const ent of readDirEnts(source)) {
    if (ent.name === ".otito" || ent.name === "node_modules") continue;
    fs.cpSync(path.join(source, ent.name), path.join(dir, ent.name), { recursive: true });
  }
  return { dir };
}

/**
 * @param {number} value
 * @returns {number}
 */
function round3(value) {
  return Math.round(value * 1000) / 1000;
}

/**
 * @param {{ generatedAt: string, corpusPath: string, k: number, counts: { retrieval: number, risk: number }, scoreboard: { retrieval: ReturnType<typeof aggregateRetrieval>, risk: ReturnType<typeof aggregateRisk> }, checks: ReturnType<typeof evaluateThresholds>, passed: boolean, exitCode: number, cases: { retrieval: ScoredRetrievalCase[], risk: ScoredRiskCase[] } }} data
 * @returns {string}
 */
export function formatRetrievalEvalMarkdown(data) {
  const lines = [
    "# otito Accuracy Eval",
    "",
    `Generated: ${data.generatedAt}`,
    `Corpus: ${data.corpusPath}`,
    `k: ${data.k}`,
    `Cases: ${data.counts.retrieval} retrieval, ${data.counts.risk} risk`,
    "",
    "## Scoreboard",
    "",
    "| Group | Metric | Value | Threshold | Pass |",
    "|---|---|---:|---:|:---:|",
    ...data.checks.map((c) => `| ${c.metric.split(".")[0]} | ${c.metric.split(".")[1]} | ${c.value} | ${c.threshold} | ${c.pass ? "yes" : "NO"} |`),
    "",
    `Retrieval: p@${data.k}=${data.scoreboard.retrieval.pAtK}, r@${data.k}=${data.scoreboard.retrieval.rAtK}, mrr=${data.scoreboard.retrieval.mrr} (${data.scoreboard.retrieval.passed}/${data.scoreboard.retrieval.cases} cases pass)`,
    `Risk: accuracy=${data.scoreboard.risk.accuracy} (${data.scoreboard.risk.passed}/${data.scoreboard.risk.cases} cases pass)`,
    "",
    `Overall: ${data.passed ? "PASS" : "FAIL"} (exit ${data.exitCode})`,
    "",
    "## Failing cases",
    "",
    ...formatFailingCases(data),
    "",
  ];
  return lines.join("\n");
}

/**
 * @param {{ generatedAt: string, corpusPath: string, counts: { fixtures: number, commands: number, passedCommands: number }, passed: boolean, exitCode: number, cases: ScoredHarnessExecutionCase[] }} data
 * @returns {string}
 */
export function formatHarnessExecutionEvalMarkdown(data) {
  const lines = [
    "# otito Harness Execution Eval",
    "",
    `Generated: ${data.generatedAt}`,
    `Corpus: ${data.corpusPath}`,
    `Fixtures: ${data.counts.fixtures}`,
    `Commands: ${data.counts.passedCommands}/${data.counts.commands} passed`,
    "",
    "## Results",
    "",
    "| Fixture | Command | Inferred | Exit | Pass |",
    "|---|---|:---:|---:|:---:|",
    ...data.cases.flatMap((testCase) =>
      testCase.commands.map(
        (command) =>
          `| ${testCase.fixture} | ${command.command} | ${command.inferred ? "yes" : "NO"} | ${command.status ?? "-"} | ${command.pass ? "yes" : "NO"} |`,
      ),
    ),
    "",
    `Overall: ${data.passed ? "PASS" : "FAIL"} (exit ${data.exitCode})`,
    "",
    "The eval copies each reviewed fixture into a temporary directory before execution. It proves only the encoded install/test/typecheck/build commands, never commands inferred from a customer repository.",
    "",
    "## Failing commands",
    "",
    ...formatFailingHarnessCommands(data),
    "",
  ];
  return lines.join("\n");
}

/**
 * @param {{ cases: ScoredHarnessExecutionCase[] }} data
 * @returns {string[]}
 */
function formatFailingHarnessCommands(data) {
  const failures = data.cases.flatMap((testCase) => testCase.commands.filter((command) => !command.pass).map((command) => ({ testCase, command })));
  if (failures.length === 0) return ["- none"];
  return failures.map(({ testCase, command }) => `- [${testCase.fixture}] ${command.command}: ${command.error ?? "failed"}`);
}

/**
 * @param {{ cases: { retrieval: ScoredRetrievalCase[], risk: ScoredRiskCase[] } }} data
 * @returns {string[]}
 */
function formatFailingCases(data) {
  /** @type {(ScoredRetrievalCase | ScoredRiskCase)[]} */
  const failing = [...data.cases.retrieval, ...data.cases.risk].filter((c) => !c.pass);
  if (failing.length === 0) {
    return ["- none"];
  }
  return failing.map((c) => {
    if (c.type === "retrieval") {
      return `- [retrieval] ${c.name}: expected ${JSON.stringify(c.expectedPrimary)} anyOf ${JSON.stringify(c.expectedAnyOf)}, got ${JSON.stringify(c.ranked)}${c.error ? ` (error: ${c.error})` : ""}`;
    }
    return `- [risk] ${c.name} (${c.mode}): missing ${JSON.stringify(c.missing)}, leaked ${JSON.stringify(c.leaked)}, got ${JSON.stringify(c.actualConcepts)}${c.error ? ` (error: ${c.error})` : ""}`;
  });
}
