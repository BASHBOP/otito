import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectRepo } from "./repo.js";
import { generateCodeMap } from "./code-map.js";
import { generateHarness } from "./harness.js";
import { generateContextPack } from "./context-engine.js";
import { classifyPath, conceptsFromQuery, isGateRiskPath, isSecretPath } from "./risk-paths.js";

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
  ".dev-context",
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

function runRepoOverview(root) {
  const repoctx = safeRun(() => {
    const result = inspectRepo(root);
    return JSON.stringify(result);
  });

  let naiveBytes = naiveListing(root).length;
  for (const f of ["README.md", "package.json", "pyproject.toml", "Cargo.toml", "go.mod", "Web.config"]) {
    const p = path.join(root, f);
    if (isFile(p)) naiveBytes += statSize(p);
  }

  return makeTaskResult("repo_overview", "Identify what this repo is", repoctx, naiveBytes);
}

function runCodeMap(root, opts) {
  let mapFileCount;
  const repoctx = safeRun(() => {
    const map = generateCodeMap(root);
    mapFileCount = (map.files ?? []).length;
    return JSON.stringify(map);
  });

  const sources = listSourceFiles(root).slice(0, opts.naiveFileCap);
  const naiveBytes = sources.reduce((sum, p) => sum + statSize(p), 0);

  return makeTaskResult("code_map", `Map the source (naive caps at ${opts.naiveFileCap} files)`, repoctx, naiveBytes, {
    mapFileCount,
    naiveFileCount: sources.length,
  });
}

function runHarness(root) {
  const repoctx = safeRun(() => {
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

  return makeTaskResult("harness", "Identify setup/validation/runtime commands", repoctx, naiveBytes);
}

function runContextPack(root, opts) {
  const repoctx = safeRun(() => {
    const result = generateContextPack(opts.query, { path: root });
    return result.markdown ?? JSON.stringify(result.data ?? result);
  });

  const sources = listSourceFiles(root).slice(0, opts.naiveFileCap);
  const naiveBytes = sources.reduce((sum, p) => sum + statSize(p), 0);

  return makeTaskResult("context_pack", `Task-aware context for: "${opts.query}"`, repoctx, naiveBytes);
}

function safeRun(fn) {
  try {
    const text = fn();
    return { ok: true, bytes: Buffer.byteLength(text, "utf8") };
  } catch (err) {
    return { ok: false, bytes: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

function makeTaskResult(name, description, repoctx, naiveBytes, extra = {}) {
  const repoctxTokens = Math.ceil(repoctx.bytes / CHARS_PER_TOKEN);
  const naiveTokens = Math.ceil(naiveBytes / CHARS_PER_TOKEN);
  const savedTokens = naiveTokens - repoctxTokens;
  const savedPct = naiveBytes > 0 ? Math.round(((naiveBytes - repoctx.bytes) / naiveBytes) * 100) : 0;
  return {
    name,
    description,
    ok: repoctx.ok,
    error: repoctx.error,
    repoctxBytes: repoctx.bytes,
    repoctxTokens,
    naiveBytes,
    naiveTokens,
    savedTokens,
    savedPct,
    ...extra,
  };
}

function aggregate(tasks) {
  const repoctxBytes = tasks.reduce((s, t) => s + t.repoctxBytes, 0);
  const naiveBytes = tasks.reduce((s, t) => s + t.naiveBytes, 0);
  const repoctxTokens = Math.ceil(repoctxBytes / CHARS_PER_TOKEN);
  const naiveTokens = Math.ceil(naiveBytes / CHARS_PER_TOKEN);
  return {
    repoctxBytes,
    naiveBytes,
    repoctxTokens,
    naiveTokens,
    savedTokens: naiveTokens - repoctxTokens,
    savedPct: naiveBytes > 0 ? Math.round(((naiveBytes - repoctxBytes) / naiveBytes) * 100) : 0,
  };
}

function naiveListing(root) {
  const lines = [];
  walk(root, root, lines, 0);
  return lines.join("\n");
}

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

function listSourceFiles(root) {
  const out = [];
  walkFiles(root, out);
  out.sort();
  return out;
}

function walkFiles(dir, out) {
  for (const ent of readDirEnts(dir)) {
    if (IGNORED_DIRS.has(ent.name)) continue;
    if (ent.name.startsWith(".")) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkFiles(full, out);
    else if (SOURCE_EXTS.has(path.extname(ent.name).toLowerCase())) out.push(full);
  }
}

function readDirEnts(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

function readDirSafe(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function statSize(p) {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}

export function formatEvalMarkdown(data) {
  const lines = [
    `# repoctx Eval: ${data.repo.name}`,
    "",
    `Generated: ${data.generatedAt}`,
    `Eval version: ${data.evalVersion}`,
    `Token method: ${data.method}`,
    `Query (for context_pack): "${data.query}"`,
    `Naive file cap: ${data.naiveFileCap}`,
    "",
    "## Per-task",
    "",
    "| Task | repoctx tokens | naive tokens | saved | saved% | coverage | ok |",
    "|---|---:|---:|---:|---:|:---:|:---:|",
    ...data.tasks.map(
      (t) => `| ${t.name} | ${t.repoctxTokens} | ${t.naiveTokens} | ${t.savedTokens} | ${t.savedPct}% | ${formatCoverage(t)} | ${t.ok ? "yes" : "no"} |`,
    ),
    "",
    "## Totals",
    "",
    `- repoctx: **${data.totals.repoctxTokens} tokens** (${data.totals.repoctxBytes} bytes)`,
    `- naive:   **${data.totals.naiveTokens} tokens** (${data.totals.naiveBytes} bytes)`,
    `- saved:   **${data.totals.savedTokens} tokens (${data.totals.savedPct}%)**`,
    "",
    "_Naive is a deterministic JS-side approximation of what a grep+ls+read agent would absorb, not a live subagent transcript. Same approximation runs on every run, so deltas across builds are the trustworthy signal._",
    "",
    "_Coverage on `code_map` is `files_mapped / files_naive_would_read`. A high savings% with low coverage means repoctx is smaller because it understands less, not because it summarised better — fix the language adapter before celebrating._",
    "",
  ];
  return lines.join("\n");
}

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
 * @param {string} [options.repoRoot] root used to resolve corpus fixtureRoots (defaults to the repoctx repo root)
 * @returns {{ data: object, markdown: string }}
 */
export function runRetrievalEval(options = {}) {
  const corpusPath = options.corpusPath ? path.resolve(options.corpusPath) : defaultCorpusPath;
  const root = options.repoRoot ? path.resolve(options.repoRoot) : repoRoot;
  const corpus = loadCorpus(corpusPath);
  const k = Number.isInteger(corpus.k) && corpus.k > 0 ? corpus.k : 5;
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

function loadCorpus(corpusPath) {
  let raw;
  try {
    raw = fs.readFileSync(corpusPath, "utf8");
  } catch (err) {
    throw new Error(`corpus not found: ${corpusPath} (${err instanceof Error ? err.message : String(err)})`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`corpus is not valid JSON: ${corpusPath} (${err instanceof Error ? err.message : String(err)})`);
  }
  if (!Array.isArray(parsed.retrieval) || !Array.isArray(parsed.risk)) {
    throw new Error(`corpus must define retrieval[] and risk[] arrays: ${corpusPath}`);
  }
  return parsed;
}

// Resolve the fixtures named by a retrieval case to absolute directories, copy
// each into an isolated temp dir (so the committed fixtures are never mutated
// and the stale `.dev-context/index.json` they ship with — pinned to an old
// absolute root and an old cache version — is dropped so the map regenerates
// from the real files), run generateContextPack, then clean the temp dirs up.
function scoreRetrievalCase(testCase, { root, fixtureRoots, k }) {
  const fixtureNames = testCase.repoFixtures ?? (testCase.repoFixture ? [testCase.repoFixture] : []);
  if (fixtureNames.length === 0) {
    throw new Error(`retrieval case "${testCase.name}" must name repoFixture or repoFixtures`);
  }
  const multiRepo = fixtureNames.length > 1;

  const temps = [];
  let ranked = [];
  let relatedInPack = [];
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
    const label = (file) => (multiRepo ? `${fixtureForPrimary(file, fixtureNames, paths)}/${file.path}` : file.path);
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
function fixtureForPrimary(file, fixtureNames, paths) {
  const root = file.repo?.root;
  const index = paths.findIndex((dir) => dir === root);
  return index >= 0 ? fixtureNames[index] : fixtureNames[0];
}

// precision@k = relevant-in-top-k / returned-in-top-k. The denominator is the
// number of files the pack actually returned (capped at k), NOT k itself:
// repoctx packs are intentionally tiny (often 1-3 primary files), so dividing a
// single correct hit by a fixed k=5 would score a *perfect* one-file pack at
// 0.2 and punish precision for being concise. Dividing by what was returned
// answers the right question — "of the files it surfaced, how many mattered?".
// recall@k = relevant-in-top-k / total-relevant. MRR = 1 / rank-of-first-
// relevant (0 if none in top-k). When a case has no required primaries (pure
// fallback) the metrics are not meaningful, so they are reported as null and
// excluded from the aggregate.
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

function aggregateRetrieval(cases) {
  const scored = cases.filter((c) => c.metrics.precisionAtK !== null);
  const avg = (selector) => (scored.length === 0 ? 0 : scored.reduce((sum, c) => sum + selector(c), 0) / scored.length);
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
function scoreRiskCase(testCase) {
  const mode = testCase.mode ?? "path";
  let actual = [];
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

function classifyRiskCase(mode, testCase) {
  switch (mode) {
    case "query":
      return conceptsFromQuery(testCase.query);
    case "path":
      return classifyPath(testCase.path);
    case "gate":
      return isGateRiskPath(testCase.path) ? ["gate"] : [];
    case "secret":
      return isSecretPath(testCase.path) ? ["secret"] : [];
    default:
      throw new Error(`unknown risk case mode "${mode}" (expected query|path|gate|secret)`);
  }
}

function aggregateRisk(cases) {
  const passed = cases.filter((c) => c.pass).length;
  return {
    cases: cases.length,
    passed,
    accuracy: cases.length === 0 ? 0 : round3(passed / cases.length),
  };
}

function evaluateThresholds(retrievalScore, riskScore, thresholds) {
  const checks = [];
  const retrievalThresholds = thresholds.retrieval ?? {};
  const riskThresholds = thresholds.risk ?? {};

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

function resolveFixture(root, fixtureRoots, name) {
  const rel = fixtureRoots[name] ?? name;
  const abs = path.isAbsolute(rel) ? rel : path.join(root, rel);
  if (!isDir(abs)) {
    throw new Error(`fixture "${name}" resolved to a missing directory: ${abs}`);
  }
  return abs;
}

function copyFixtureToTemp(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "repoctx-eval-fix-"));
  for (const ent of readDirEnts(source)) {
    if (ent.name === ".dev-context") continue;
    fs.cpSync(path.join(source, ent.name), path.join(dir, ent.name), { recursive: true });
  }
  return { dir };
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

export function formatRetrievalEvalMarkdown(data) {
  const lines = [
    "# repoctx Accuracy Eval",
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

function formatFailingCases(data) {
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
