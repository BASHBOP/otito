// otito impact: given a free-text change request, rank the files most likely
// to own the change. Ports impact-map's scoring (text.py + scoring.py +
// validation.py) onto otito's AST code map. The substrate change is the
// point — code-map already filters to source extensions, so the documentation/
// false-positive class from the field test cannot enter the candidate set.

/// <reference types="node" />
import path from "node:path";
import { getCachedCodeMap } from "./index-cache.js";
import { conceptsFromQuery, classifyPath, CONCEPT_SYNONYMS, RISK_FLAGS, glyphFor, singularizeToken } from "./risk-paths.js";
import { estimateTokens, estimateTokenSections } from "./tokens.js";
import { runCommand } from "./tools.js";

export const DIFF_RENAME_LIMIT = 1000;

/**
 * @typedef {import('./index-cache.js').CodeMapFile} CodeMapFile
 * @typedef {import('./index-cache.js').CodeMapRepo} CodeMapRepo
 */

/**
 * Options for generateImpact.
 * @typedef {object} ImpactOptions
 * @property {number} [top]
 * @property {string} [path]
 * @property {string} [diffBase]
 * @property {string[]} [diffFiles]
 * @property {any} [codeMap]
 */

/**
 * A scored candidate file as held in the scoring map.
 * @typedef {object} ScoredEntry
 * @property {CodeMapFile} file
 * @property {number} score
 * @property {string[]} reasons
 * @property {string[]} relatedFiles
 */

/**
 * The per-file score/reasons produced by scoreFile.
 * @typedef {object} ScoreResult
 * @property {number} score
 * @property {string[]} reasons
 */

const impactEngineVersion = 3;
const defaultTop = 10;

const STOP_WORDS = new Set([
  "a",
  "add",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "can",
  "change",
  "do",
  "fix",
  "for",
  "from",
  "get",
  "has",
  "have",
  "i",
  "in",
  "into",
  "is",
  "it",
  "make",
  "need",
  "new",
  "of",
  "on",
  "or",
  "our",
  "please",
  "should",
  "that",
  "the",
  "this",
  "to",
  "update",
  "use",
  "want",
  "we",
  "when",
  "with",
]);

const DOMAIN_KEYWORDS = new Set([
  "api",
  "auth",
  "booking",
  "billing",
  "cache",
  "checkout",
  "csv",
  "database",
  "email",
  "export",
  "import",
  "invoice",
  "login",
  "migration",
  "notification",
  "order",
  "payment",
  "refund",
  "report",
  "route",
  "schema",
  "stripe",
  "subscription",
  "upload",
  "user",
  "webhook",
]);

const TEST_MATCH_STOP_TERMS = new Set([
  "app",
  "backend",
  "component",
  "components",
  "frontend",
  "helper",
  "helpers",
  "hook",
  "hooks",
  "index",
  "lib",
  "screen",
  "service",
  "services",
  "src",
  "test",
  "tests",
  "types",
  "ui",
  "util",
  "utils",
]);

// Scoring weights, kept close to impact-map's originals so the ranking remains
// intuitive for anyone familiar with that tool.
const W_PATH = 9.0;
const W_SYMBOL = 5.0;
const W_ROUTE = 7.0;
const W_EXPORT = 4.0;
const W_IMPORT = 2.5;
const W_CONCEPT = 6.0;
const W_CONFIG_HINT = 4.0;

const CONFIG_HINTS = {
  docker: ["dockerfile", "docker-compose"],
  env: [".env", "config", "settings"],
  config: ["config", "settings"],
  deploy: ["dockerfile", "procfile", "wrangler", "vercel", "netlify"],
  database: ["schema", "migration", "prisma"],
  migration: ["schema", "migration", "prisma"],
  stripe: ["stripe"],
  auth: ["auth", "session", "middleware"],
};

// Kinds that are real implementation owners. The presence of one of these in
// the top-5 is what we are optimizing for — these get the concept boost.
const OWNER_KINDS = new Set(["controller", "service", "route", "apiRoute", "apiClient", "schema", "dto", "module", "component", "template"]);

// Paths that are usually not the owner of a behavior change. Demoted but not
// dropped — sometimes the right answer IS a script.
const PENALTY_PATH_PREFIXES = [
  { prefix: "scripts/", factor: 0.55, reason: "operational script, demoted vs implementation files" },
  { prefix: "src/scripts/", factor: 0.55, reason: "operational script, demoted vs implementation files" },
  { prefix: "documentation/", factor: 0.3, reason: "generated documentation, demoted" },
  { prefix: "docs/", factor: 0.6, reason: "documentation file, demoted unless docs are requested" },
];

/**
 * @param {string} query
 * @param {ImpactOptions} [options]
 */
export function generateImpact(query, options = {}) {
  const normalized = String(query ?? "").trim();
  if (!normalized) {
    throw new Error("impact requires a non-empty query");
  }

  const top = clampInt(options.top, defaultTop, 1, 50);
  const repoPath = options.path ?? ".";
  const map = options.codeMap ?? getCachedCodeMap(repoPath);
  const weightedQuery = weightedQueryTerms(normalized);
  const concepts = conceptsFromQuery(normalized);
  const wantsTests = queryMentions(weightedQuery, ["test", "tests", "spec", "coverage", "qa"]);
  const wantsDocs = queryMentions(weightedQuery, ["doc", "docs", "documentation", "readme", "changelog"]);

  const scored = scoreFiles(map.files, weightedQuery, concepts, { wantsTests, wantsDocs });
  const withBoosts = applyDependencyBoosts(map.files, scored);
  const heuristicRanked = [...withBoosts.values()].sort((a, b) => b.score - a.score).slice(0, top);
  const roles = classifyImpactRoles(heuristicRanked, map.files, normalized);
  const diffSnapshot = captureDiffSnapshot(map.repo.root, options.diffBase, options.diffFiles);
  const exactDiffFiles = diffSnapshot?.ok ? (diffSnapshot.files ?? []) : [];
  const diffEvidence = diffSnapshot?.ok ? buildDiffEvidence(exactDiffFiles, map.files, withBoosts, diffSnapshot.base) : null;
  // A requested Git diff is evidence, not another fuzzy ranking signal. Put every
  // mapped changed file ahead of heuristic candidates and label it as such, so an
  // agent cannot silently overlook the source files that actually changed.
  const ranked = addPredictableSupportFiles(diffEvidence ? mergeDiffEvidence(diffEvidence.entries, heuristicRanked) : heuristicRanked, map.files, roles);

  const testSuggestions = suggestTests(map.files, ranked, map.repo);
  const implementationPlan = buildPlan(normalized, ranked);
  const risks = identifyRisks(normalized, ranked, concepts);
  const validation = diffSnapshot ? (diffSnapshot.ok ? validateChangedFiles(diffSnapshot.base, exactDiffFiles, roles) : diffSnapshot) : null;

  const data = /** @type {Record<string, any> & { tokenEstimate?: any }} */ ({
    ok: true,
    generatedAt: new Date().toISOString(),
    impactEngineVersion,
    query: normalized,
    repo: {
      name: map.repo.name,
      root: map.repo.root,
      sourceFileCount: map.repo.sourceFileCount,
    },
    concepts,
    diffEvidence: diffEvidence
      ? {
          base: diffEvidence.base,
          changedFileCount: diffEvidence.files.length,
          mappedFiles: diffEvidence.entries.map((entry) => entry.file.path),
          unmappedFiles: diffEvidence.unmappedFiles,
        }
      : null,
    topFiles: ranked.map((entry) => ({
      path: entry.file.path,
      kind: entry.file.kind,
      domain: entry.file.domain,
      score: round(entry.score),
      reasons: entry.reasons,
      relatedFiles: entry.relatedFiles.slice(0, 8),
      role: roles.byPath.get(entry.file.path) ?? "advisory",
      riskFlags: classifyPath(entry.file.path, { kind: entry.file.kind }),
    })),
    testSuggestions,
    implementationPlan,
    risks,
    classifications: {
      requiredOwners: roles.requiredOwners,
      supportingFiles: roles.supportingFiles,
      advisoryFiles: roles.advisoryFiles,
    },
    validation,
  });

  data.tokenEstimate = {
    ...estimateTokenSections([
      { name: "concepts", value: data.concepts },
      { name: "diffEvidence", value: data.diffEvidence },
      { name: "topFiles", value: data.topFiles },
      { name: "testSuggestions", value: data.testSuggestions },
      { name: "implementationPlan", value: data.implementationPlan },
      { name: "risks", value: data.risks },
    ]),
    fullJson: estimateTokens(data),
  };

  const markdown = formatImpactMarkdown(data);
  data.tokenEstimate.markdown = estimateTokens(markdown);

  return { data, markdown };
}

/**
 * @param {CodeMapFile[]} files
 * @param {Map<string, number>} weightedQuery
 * @param {string[]} concepts
 * @param {{ wantsTests: boolean, wantsDocs: boolean }} flags
 * @returns {Map<string, ScoredEntry>}
 */
function scoreFiles(files, weightedQuery, concepts, { wantsTests, wantsDocs }) {
  /** @type {Map<string, ScoredEntry>} */
  const scored = new Map();
  for (const file of files) {
    const result = scoreFile(file, weightedQuery, concepts, { wantsTests, wantsDocs });
    if (result.score > 0) {
      scored.set(file.path, { file, score: result.score, reasons: result.reasons, relatedFiles: [] });
    }
  }
  return scored;
}

/**
 * @param {CodeMapFile} file
 * @param {Map<string, number>} weightedQuery
 * @param {string[]} concepts
 * @param {{ wantsTests: boolean, wantsDocs: boolean }} flags
 * @returns {ScoreResult}
 */
function scoreFile(file, weightedQuery, concepts, { wantsTests, wantsDocs }) {
  const pathTokens = tokenize(file.path);
  const pathCounts = countTokens(pathTokens);
  const symbolTokens = tokenize(file.symbols.map((symbol) => symbol.name ?? "").join(" "));
  const symbolCounts = countTokens(symbolTokens);
  const exportTokens = tokenize((file.exports ?? []).join(" "));
  const importTokens = tokenize((file.imports ?? []).join(" "));
  const routeTokens = tokenize([file.controllerBasePath ?? "", file.route ?? "", (file.httpMethods ?? []).join(" ")].join(" "));

  let score = 0;
  /** @type {string[]} */
  const reasons = [];

  // Path matches — strongest single signal because path naming reflects intent.
  // Counts capped at 1 per term so "validation" appearing twice in a directory
  // + filename can't out-rank a single-match owner file from another domain.
  const pathHits = matchedTerms(pathCounts, weightedQuery);
  if (pathHits.length) {
    const amount = pathHits.reduce((sum, term) => sum + W_PATH * /** @type {number} */ (weightedQuery.get(term)), 0);
    score += amount;
    reasons.push(`path matches: ${pathHits.slice(0, 8).join(", ")}`);
  }

  const symbolHits = matchedTerms(symbolCounts, weightedQuery);
  if (symbolHits.length) {
    const amount = symbolHits.reduce((sum, term) => sum + W_SYMBOL * /** @type {number} */ (weightedQuery.get(term)), 0);
    score += amount;
    reasons.push(`symbol matches: ${symbolHits.slice(0, 8).join(", ")}`);
  }

  const exportHits = matchedTerms(countTokens(exportTokens), weightedQuery);
  if (exportHits.length) {
    const amount = exportHits.reduce((sum, term) => sum + W_EXPORT * /** @type {number} */ (weightedQuery.get(term)), 0);
    score += amount;
    reasons.push(`export matches: ${exportHits.slice(0, 6).join(", ")}`);
  }

  const importHits = matchedTerms(countTokens(importTokens), weightedQuery);
  if (importHits.length) {
    const amount = importHits.reduce((sum, term) => sum + W_IMPORT * /** @type {number} */ (weightedQuery.get(term)), 0);
    score += amount;
    reasons.push(`import matches: ${importHits.slice(0, 6).join(", ")}`);
  }

  const routeHits = matchedTerms(countTokens(routeTokens), weightedQuery);
  if (routeHits.length) {
    const amount = routeHits.reduce((sum, term) => sum + W_ROUTE * /** @type {number} */ (weightedQuery.get(term)), 0);
    score += amount;
    reasons.push(`route matches: ${routeHits.slice(0, 6).join(", ")}`);
  }

  // Concept boost: file's risk flags or content overlap the query's implied
  // concepts. This is what makes "Apple sign-in" find auth controllers even
  // when the request says nothing literal about auth. Without it, a file
  // matching a generic word like "validation" out-ranks the real owner.
  const impliedConcepts = concepts.length ? fileImpliesConcepts(file, concepts) : new Set();
  if (impliedConcepts.size > 0) {
    const conceptBoost = W_CONCEPT * impliedConcepts.size;
    score = score * 1.4 + conceptBoost;
    reasons.push(`concept match: ${[...impliedConcepts].join(", ")} (×1.4 + ${conceptBoost.toFixed(1)})`);
  } else if (concepts.length > 0) {
    // No file matched the query's concepts: demote, but proportionally and
    // safely. A single confident concept is a strong signal that off-concept
    // files are wrong, so demote hard; but when several concepts were detected
    // they are more likely to disagree (and any one file rarely covers them
    // all), so soften the demotion toward 1.0 as concept count grows. This
    // keeps one stray concept from skewing the whole ranking.
    const factor = conceptDemotionFactor(concepts.length);
    score *= factor;
    reasons.push(`no concept match for query, demoted (×${factor.toFixed(2)})`);
  }

  const configBonus = computeConfigBonus(file.path, weightedQuery);
  if (configBonus) {
    score += configBonus;
    reasons.push(`configuration/domain hint (+${configBonus.toFixed(1)})`);
  }

  if (score === 0) {
    return { score: 0, reasons: [] };
  }

  // Kind/domain penalties — the substantive quality improvement over impact-map.
  if (file.kind === "test") {
    if (wantsTests) {
      score *= 0.9;
      reasons.push("test file, query mentions tests");
    } else {
      score *= 0.45;
      reasons.push("test file, ranked lower than implementation");
    }
  }

  for (const { prefix, factor, reason } of PENALTY_PATH_PREFIXES) {
    if (file.path.startsWith(prefix)) {
      if (prefix === "docs/" && wantsDocs) continue;
      score *= factor;
      reasons.push(reason);
      break;
    }
  }

  if (OWNER_KINDS.has(file.kind)) {
    score *= 1.15;
    reasons.push(`owner kind ${file.kind}, slight boost`);
  }

  return { score, reasons };
}

// Demotion factor for a file that matches none of the query's concepts.
// One concept → 0.5 (a confident single signal; matches the original behavior
// and the ranking the existing tests assert). Each additional detected concept
// softens the penalty by 0.15, capped at 0.8 so a multi-concept (and therefore
// noisier) query can never erase an otherwise strong path/symbol match.
/**
 * @param {number} conceptCount
 * @returns {number}
 */
function conceptDemotionFactor(conceptCount) {
  if (conceptCount <= 1) return 0.5;
  return Math.min(0.8, 0.5 + 0.15 * (conceptCount - 1));
}

// A file "implies" a concept if either (a) its path classifies as that
// concept, or (b) its symbols/imports/exports contain a synonym for that
// concept. (b) is what catches booking.controller.ts as money-flow-adjacent
// even though its path is "src/booking/...".
/**
 * @param {CodeMapFile} file
 * @param {string[]} concepts
 * @returns {Set<string>}
 */
function fileImpliesConcepts(file, concepts) {
  /** @type {Set<string>} */
  const implied = new Set();
  const pathFlags = new Set(classifyPath(file.path, { kind: file.kind }));
  for (const concept of concepts) {
    if (pathFlags.has(concept)) implied.add(concept);
  }
  if (implied.size === concepts.length) return implied;
  const haystack = [
    ...(file.symbols ?? []).map((s) => (s.name ?? "").toLowerCase()),
    ...(file.imports ?? []).map((i) => i.toLowerCase()),
    ...(file.exports ?? []).map((e) => e.toLowerCase()),
  ];
  if (haystack.length === 0) return implied;
  for (const concept of concepts) {
    if (implied.has(concept)) continue;
    const synonyms = CONCEPT_SYNONYMS[concept] ?? [];
    for (const synonym of synonyms) {
      if (haystack.some((token) => token === synonym || token.includes(synonym))) {
        implied.add(concept);
        break;
      }
    }
  }
  return implied;
}

/**
 * @param {CodeMapFile[]} allFiles
 * @param {Map<string, ScoredEntry>} scored
 * @returns {Map<string, ScoredEntry>}
 */
function applyDependencyBoosts(allFiles, scored) {
  if (scored.size === 0) return scored;
  const byPath = new Map(allFiles.map((file) => [file.path, file]));
  const seeds = [...scored.values()].sort((a, b) => b.score - a.score).slice(0, 15);
  const resolve = makeImportResolver(allFiles);

  for (const seed of seeds) {
    const base = Math.min(seed.score * 0.16, 8.0);
    /** @type {Set<string>} */
    const neighbors = new Set();
    for (const importPath of seed.file.imports ?? []) {
      for (const resolved of resolve(importPath, seed.file.path)) {
        if (resolved !== seed.file.path) neighbors.add(resolved);
      }
    }
    for (const neighbor of neighbors) {
      const existing = scored.get(neighbor);
      if (existing) {
        existing.score += base;
        existing.reasons.push(`related through imports (+${base.toFixed(1)})`);
        existing.relatedFiles.push(seed.file.path);
        seed.relatedFiles.push(neighbor);
      } else if (byPath.has(neighbor)) {
        scored.set(neighbor, {
          file: /** @type {CodeMapFile} */ (byPath.get(neighbor)),
          score: base,
          reasons: [`related through imports from ${seed.file.path} (+${base.toFixed(1)})`],
          relatedFiles: [seed.file.path],
        });
        seed.relatedFiles.push(neighbor);
      }
    }
  }

  for (const entry of scored.values()) {
    entry.relatedFiles = [...new Set(entry.relatedFiles)].slice(0, 8);
  }
  return scored;
}

/**
 * @param {CodeMapFile[]} files
 * @returns {(importSpec: string, fromPath: string) => string[]}
 */
function makeImportResolver(files) {
  /** @type {Map<string, string[]>} */
  const byBasename = new Map();
  /** @type {Map<string, string[]>} */
  const byStem = new Map();
  for (const file of files) {
    const base = path.basename(file.path);
    const stem = base.replace(/\.[^.]+$/, "");
    pushTo(byBasename, base, file.path);
    pushTo(byStem, stem, file.path);
  }
  return (/** @type {string} */ importSpec, /** @type {string} */ fromPath) => {
    /** @type {Set<string>} */
    const candidates = new Set();
    if (importSpec.startsWith(".")) {
      const base = path.posix.dirname(fromPath);
      const joined = path.posix.normalize(`${base}/${importSpec}`);
      for (const file of files) {
        if (file.path === joined || file.path.startsWith(`${joined}/`) || file.path.startsWith(joined.replace(/\/[^/]+$/, "/"))) {
          candidates.add(file.path);
        }
        const stem = file.path.replace(/\.[^.]+$/, "");
        if (stem === joined || stem === `${joined}/index`) {
          candidates.add(file.path);
        }
      }
    } else {
      const tail = importSpec.split("/").pop() ?? "";
      const stem = tail.replace(/\.[^.]+$/, "");
      (byBasename.get(tail) ?? []).forEach((p) => candidates.add(p));
      (byStem.get(stem) ?? []).forEach((p) => candidates.add(p));
    }
    return [...candidates].slice(0, 5);
  };
}

/**
 * @param {CodeMapFile[]} files
 * @param {ScoredEntry[]} ranked
 * @param {CodeMapRepo} repo
 * @returns {string[]}
 */
function suggestTests(files, ranked, repo) {
  /** @type {string[]} */
  const suggestions = [];
  /** @type {Record<string, string>} */
  const scripts = /** @type {any} */ (repo.package)?.scripts ?? {};
  for (const name of ["test", "test:unit", "test:integration", "test:e2e", "lint", "typecheck"]) {
    if (scripts[name]) {
      suggestions.push(`Run package script \`${name}\`: ${scripts[name]}`);
    }
  }

  /** @type {Set<string>} */
  const topTerms = new Set();
  for (const entry of ranked) {
    for (const token of tokenize(entry.file.path)) topTerms.add(token);
    for (const symbol of entry.file.symbols.slice(0, 20)) for (const token of tokenize(symbol.name ?? "")) topTerms.add(token);
  }
  const meaningfulTerms = new Set([...topTerms].filter((term) => term.length > 2 && !TEST_MATCH_STOP_TERMS.has(term)));

  const testFiles = files.filter((file) => file.kind === "test");
  /** @type {{ overlap: number, path: string }[]} */
  const matches = [];
  for (const testFile of testFiles) {
    const terms = new Set([...tokenize(testFile.path)].filter((t) => t.length > 2 && !TEST_MATCH_STOP_TERMS.has(t)));
    let overlap = 0;
    for (const term of terms) if (meaningfulTerms.has(term)) overlap += 1;
    if (overlap > 0) matches.push({ overlap, path: testFile.path });
  }
  matches.sort((a, b) => b.overlap - a.overlap);
  for (const match of matches.slice(0, 8)) {
    suggestions.push(`Inspect or run related test \`${match.path}\``);
  }

  if (suggestions.length === 0) {
    suggestions.push("No matching test file found. Add focused coverage around the highest-ranked impacted file.");
  }
  return dedupe(suggestions);
}

/**
 * @param {string} query
 * @param {ScoredEntry[]} ranked
 * @returns {string[]}
 */
function buildPlan(query, ranked) {
  if (ranked.length === 0) {
    return [
      "Clarify the change request with the exact feature area, expected behavior, and examples.",
      "Search the repo manually for the domain terms in the request.",
      "Add or update a focused test before changing behavior.",
    ];
  }

  const implementation = ranked.filter((entry) => entry.file.kind !== "test");
  const primary = (implementation[0] ?? ranked[0]).file.path;
  const supporting = implementation.slice(1, 4).map((entry) => entry.file.path);

  const plan = [
    `Open \`${primary}\` first and decide whether it owns the requested behavior or only calls into another file.`,
    "Follow its imports/callers into related files before editing so the change lands at the owner, not just the highest-ranked match.",
    "Make the smallest implementation change in the owner file, then adjust supporting files only if required.",
    "Use the ranked list as a checklist: edit primary owner, inspect supporting files for side effects.",
    "Run or add the closest focused test, then run the repo's broader test/lint command.",
  ];
  if (supporting.length) {
    plan.splice(1, 0, `Keep these supporting files open while tracing side effects: ${supporting.map((p) => `\`${p}\``).join(", ")}.`);
  }
  if (ranked.some((entry) => entry.file.kind === "schema" || entry.file.path.toLowerCase().includes("schema"))) {
    plan.splice(2, 0, "Review schema or migration impact before changing application code.");
  }
  if (ranked.some((entry) => (entry.file.httpMethods ?? []).length || entry.file.kind === "controller" || entry.file.kind === "apiRoute")) {
    plan.splice(2, 0, "Check the matched routes/controllers for request/response contracts and downstream consumers.");
  }
  return plan;
}

/**
 * @param {string} query
 * @param {ScoredEntry[]} ranked
 * @param {string[]} concepts
 * @returns {string[]}
 */
function identifyRisks(query, ranked, concepts) {
  const flags = new Set(concepts);
  for (const entry of ranked) {
    for (const flag of classifyPath(entry.file.path, { kind: entry.file.kind })) {
      flags.add(flag);
    }
  }
  if (flags.size === 0) {
    return ["No obvious high-risk domain detected. Main risk is missing a caller or test outside the matched files."];
  }
  return [...flags].map(riskSentence);
}

/**
 * @param {string} flag
 * @returns {string}
 */
function riskSentence(flag) {
  switch (flag) {
    case RISK_FLAGS.authSecurity:
      return "Auth/security change: verify permissions, redirects, sessions, and unauthorized states.";
    case RISK_FLAGS.moneyFlow:
      return "Money-flow change: verify idempotency, webhook behavior, refunds, invoices, and provider edge cases.";
    case RISK_FLAGS.dataModel:
      return "Data-model change: check migrations, seed data, rollback behavior, and query compatibility.";
    case RISK_FLAGS.requestSurface:
      return "Request-surface change: verify request/response shape, validation, client consumers, and backward compatibility.";
    case RISK_FLAGS.contract:
      return "Frontend/backend contract change: verify the client and server agree on payload, status codes, and error shapes.";
    case RISK_FLAGS.configuration:
      return "Configuration change: verify environment variables, secrets, build output, and production defaults.";
    case RISK_FLAGS.largeFileDiff:
      return "Large-file change: review for unrelated edits and consider splitting follow-up PRs.";
    case RISK_FLAGS.secret:
      return "Secret-path change: confirm the file is not committed with real values and rotate any exposed credentials.";
    default:
      return `${flag} change: review related downstream consumers and tests.`;
  }
}

/**
 * Capture the changed-file subject once before it is used for both evidence and
 * validation. Supplied diff files come from an immutable Git subject in the
 * convergence path; direct CLI use captures the current diff plus untracked
 * user files.
 * @param {string} root
 * @param {string | undefined} base
 * @param {string[] | undefined} suppliedFiles
 */
function captureDiffSnapshot(root, base, suppliedFiles) {
  if (Array.isArray(suppliedFiles)) {
    return { base: base ?? "", ok: true, files: normalizeChangedFiles(suppliedFiles) };
  }
  if (!base) {
    return null;
  }

  // Resolve user input before passing it to `git diff`. The resolved value is
  // a hex object ID, so a ref beginning with `-` cannot be parsed as an option.
  const resolved = runCommand("git", ["--no-replace-objects", "rev-parse", "--verify", "--end-of-options", `${base}^{commit}`], { cwd: root });
  if (!resolved.ok || !resolved.stdout.trim()) {
    const message = (resolved.stderr || resolved.error?.message || "command failed").trim();
    return {
      base,
      ok: false,
      error: `git diff failed: could not resolve base ref: ${message}`,
    };
  }
  const result = runCommand(
    "git",
    [
      "--no-replace-objects",
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--ignore-submodules=none",
      "--diff-algorithm=myers",
      "--find-renames=50%",
      `-l${DIFF_RENAME_LIMIT}`,
      "--name-only",
      "-z",
      resolved.stdout.trim(),
      "--",
    ],
    { cwd: root },
  );
  if (!result.ok) {
    const message = (result.stderr || result.error?.message || "command failed").trim();
    return {
      base,
      ok: false,
      error: `git diff failed: ${message}`,
    };
  }
  const untracked = runCommand("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd: root });
  if (!untracked.ok) {
    const message = (untracked.stderr || untracked.error?.message || "command failed").trim();
    return {
      base,
      ok: false,
      error: `git ls-files failed: ${message}`,
    };
  }

  return {
    base,
    ok: true,
    files: normalizeChangedFiles([...result.stdout.split("\0"), ...untracked.stdout.split("\0")]),
  };
}

/**
 * @param {string[]} files
 * @returns {string[]}
 */
function normalizeChangedFiles(files) {
  return [...new Set(files.map(String).filter(Boolean))].sort();
}

/**
 * Build exact changed-file entries. A file absent from the code map can be a
 * deletion, a binary, or an unsupported file type; keep it visible separately
 * instead of pretending the map knows its owner.
 * @param {string[]} files
 * @param {CodeMapFile[]} allFiles
 * @param {Map<string, ScoredEntry>} scored
 * @param {string} base
 */
function buildDiffEvidence(files, allFiles, scored, base) {
  const byPath = new Map(allFiles.map((file) => [file.path, file]));
  /** @type {ScoredEntry[]} */
  const entries = [];
  /** @type {string[]} */
  const unmappedFiles = [];
  for (const filePath of files) {
    const file = byPath.get(filePath);
    if (!file) {
      unmappedFiles.push(filePath);
      continue;
    }
    const candidate = scored.get(filePath);
    entries.push({
      file,
      score: candidate?.score ?? 0,
      reasons: [...(candidate?.reasons ?? []), `exact Git diff evidence against ${base}`],
      relatedFiles: candidate?.relatedFiles ?? [],
    });
  }
  return { base, files, entries, unmappedFiles };
}

/**
 * @param {ScoredEntry[]} evidence
 * @param {ScoredEntry[]} heuristic
 * @returns {ScoredEntry[]}
 */
function mergeDiffEvidence(evidence, heuristic) {
  const changed = new Set(evidence.map((entry) => entry.file.path));
  return [...evidence, ...heuristic.filter((entry) => !changed.has(entry.file.path))];
}

/**
 * Separate the small set of files predicted to own the implementation from
 * expected fan-out and broader inspection leads. Only required owners lower
 * convergence coverage when they are untouched; support files are accepted
 * when changed, while advisory files are deliberately non-load-bearing.
 * @param {ScoredEntry[]} heuristicRanked
 * @param {CodeMapFile[]} allFiles
 * @param {string} query
 */
function classifyImpactRoles(heuristicRanked, allFiles, query) {
  /** @type {Map<string, "required" | "supporting" | "advisory">} */
  const byPath = new Map();
  const directOwners = heuristicRanked
    .filter((entry) => OWNER_KINDS.has(entry.file.kind) && hasDirectIntentMatch(entry))
    .slice(0, 4)
    .map((entry) => entry.file.path);
  for (const file of directOwners) byPath.set(file, "required");

  const terms = new Set(tokenize(query));
  const templateFlow = ["email", "template", "preview", "branding", "campaign", "audience", "newsletter"].some((term) => terms.has(term));
  const releaseFlow = ["release", "changelog", "version"].some((term) => terms.has(term));
  for (const file of allFiles) {
    const role = predictableRole(file, { templateFlow, releaseFlow });
    if (!role || byPath.has(file.path)) continue;
    byPath.set(file.path, role === "template" ? "required" : "supporting");
  }

  for (const entry of heuristicRanked) {
    if (!byPath.has(entry.file.path)) byPath.set(entry.file.path, "advisory");
  }
  const requiredOwners = [...byPath.entries()]
    .filter(([, role]) => role === "required")
    .map(([file]) => file)
    .sort();
  const supportingFiles = [...byPath.entries()]
    .filter(([, role]) => role === "supporting")
    .map(([file]) => file)
    .sort();
  const advisoryFiles = [...byPath.entries()]
    .filter(([, role]) => role === "advisory")
    .map(([file]) => file)
    .sort();
  return { byPath, requiredOwners, supportingFiles, advisoryFiles };
}

/** @param {ScoredEntry} entry */
function hasDirectIntentMatch(entry) {
  return entry.reasons.some((reason) => /^(path|symbol|export|route) matches:/.test(reason));
}

/** @param {CodeMapFile} file @param {{ templateFlow: boolean, releaseFlow: boolean }} options */
function predictableRole(file, options) {
  if (options.templateFlow && file.kind === "template") return "template";
  if (options.templateFlow && ["translation", "config"].includes(file.kind)) return "support";
  if (options.templateFlow && file.kind === "test" && /(preview|template|email|i18n|locale|snapshot)/i.test(file.path)) return "support";
  if (options.releaseFlow && file.kind === "changelog") return "support";
  return null;
}

/**
 * Keep expected fan-out visible even when it lacks lexical overlap with the
 * request (for example `locales/en.json` beside an email template). These
 * entries are labelled supporting and never become convergence owners.
 * @param {ScoredEntry[]} ranked
 * @param {CodeMapFile[]} allFiles
 * @param {{ byPath: Map<string, string> }} roles
 */
function addPredictableSupportFiles(ranked, allFiles, roles) {
  const existing = new Set(ranked.map((entry) => entry.file.path));
  const baseline = ranked[0]?.score ?? 1;
  const additions = allFiles
    .filter((file) => !existing.has(file.path) && roles.byPath.get(file.path) && roles.byPath.get(file.path) !== "advisory")
    .slice(0, 12)
    .map((file) => ({
      file,
      score: Math.max(1, baseline * 0.2),
      reasons: [`predictable ${roles.byPath.get(file.path)} fan-out`],
      relatedFiles: [],
    }));
  return [...ranked, ...additions];
}

/**
 * Compare role-labelled candidates with the exact changed-file subject. Exact
 * diff evidence remains visible, but cannot turn an unexplained change into a
 * successful prediction.
 * @param {string} base
 * @param {string[]} files
 * @param {{ requiredOwners: string[], supportingFiles: string[], advisoryFiles: string[] }} roles
 */
function validateChangedFiles(base, files, roles) {
  const changedFiles = normalizeChangedFiles(files);

  const predictedDirect = new Set(roles.requiredOwners);
  const predictedRelated = new Set(roles.supportingFiles);

  const confirmedDirect = changedFiles.filter((file) => predictedDirect.has(file));
  const confirmedRelated = changedFiles.filter((file) => !predictedDirect.has(file) && predictedRelated.has(file));
  const unconfirmedCandidates = [...predictedDirect].filter((file) => !changedFiles.includes(file));
  const advisory = new Set(roles.advisoryFiles);
  const missedChangedFiles = changedFiles.filter((file) => !predictedDirect.has(file) && !predictedRelated.has(file) && !advisory.has(file));

  let verdict = "partial";
  if (confirmedDirect.length && missedChangedFiles.length === 0) verdict = "confirmed";
  else if (confirmedDirect.length === 0 && confirmedRelated.length === 0) verdict = "missed";

  return {
    base,
    ok: true,
    changedFiles,
    confirmedDirect,
    confirmedRelated,
    unconfirmedCandidates,
    missedChangedFiles,
    verdict,
    heuristic: {
      confirmedDirect: confirmedDirect,
      confirmedRelated: confirmedRelated,
      missedChangedFiles,
    },
  };
}

/**
 * @param {ReturnType<typeof generateImpact>['data']} data
 * @returns {string}
 */
export function formatImpactMarkdown(data) {
  const lines = [
    `# Change Impact: ${data.query}`,
    "",
    `Generated: ${data.generatedAt}`,
    `Impact engine version: ${data.impactEngineVersion}`,
    "",
    "## Repo",
    "",
    `- ${data.repo.name}: ${data.repo.root} (${data.repo.sourceFileCount} source file(s))`,
    `- Inferred concepts: ${data.concepts.join(", ") || "none"}`,
    "",
  ];
  if (data.diffEvidence) {
    lines.push("## Exact Changed-File Evidence", "");
    lines.push(`- Base: ${data.diffEvidence.base}`);
    lines.push(`- Mapped changed files: ${formatList(data.diffEvidence.mappedFiles)}`);
    lines.push(`- Unmapped changed files: ${formatList(data.diffEvidence.unmappedFiles)}`);
    lines.push("");
  }
  lines.push("## Top Impacted Files", "");
  for (const [index, file] of data.topFiles.entries()) {
    const rank = index + 1;
    lines.push(`### ${rank}. \`${file.path}\``);
    lines.push("");
    lines.push(`- Kind: ${file.kind} · domain: ${file.domain}`);
    lines.push(`- Role: ${file.role}`);
    lines.push(`- Score: ${file.score}`);
    if (file.riskFlags.length) lines.push(`- Risk flags: ${file.riskFlags.join(", ")}`);
    for (const reason of file.reasons) lines.push(`- ${reason}`);
    if (file.relatedFiles.length) lines.push(`- Related: ${file.relatedFiles.map((/** @type {string} */ r) => `\`${r}\``).join(", ")}`);
    lines.push("");
  }
  lines.push("## Impact Roles", "");
  lines.push(`- Required owners: ${formatList(data.classifications.requiredOwners)}`);
  lines.push(`- Predictable supporting files: ${formatList(data.classifications.supportingFiles)}`);
  lines.push(`- Worth inspecting: ${formatList(data.classifications.advisoryFiles)}`);
  lines.push("## Tests To Run Or Add", "");
  for (const suggestion of data.testSuggestions) lines.push(`- ${suggestion}`);
  lines.push("", "## Implementation Plan", "");
  for (const [index, step] of data.implementationPlan.entries()) lines.push(`${index + 1}. ${step}`);
  lines.push("", "## Risks To Check", "");
  for (const risk of data.risks) lines.push(`- ${risk}`);
  if (data.validation) {
    lines.push("", "## Validation Against Diff", "");
    lines.push(`- Base: ${data.validation.base}`);
    if (!data.validation.ok) {
      lines.push(`- Error: ${data.validation.error}`);
    } else {
      lines.push(`- Verdict: ${data.validation.verdict}`);
      lines.push(`- Confirmed direct: ${formatList(data.validation.confirmedDirect)}`);
      lines.push(`- Confirmed related: ${formatList(data.validation.confirmedRelated)}`);
      lines.push(`- Unconfirmed candidates: ${formatList(data.validation.unconfirmedCandidates)}`);
      lines.push(`- Unexplained changed files: ${formatList(data.validation.missedChangedFiles)}`);
    }
  }
  return lines.join("\n");
}

/**
 * @param {string[]} items
 * @returns {string}
 */
function formatList(items) {
  return items.length ? items.map((item) => `\`${item}\``).join(", ") : "none";
}

// Tokenize a string into lowercased path/identifier tokens. Mirrors
// impact-map's tokenize/split_identifier behavior.
/**
 * @param {unknown} value
 * @returns {string[]}
 */
export function tokenize(value) {
  const raw = String(value ?? "");
  /** @type {string[]} */
  const tokens = [];
  const chunks = raw.match(/[A-Za-z0-9_./:-]+/g) ?? [];
  for (const chunk of chunks) {
    const spaced = chunk.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
    for (const part of spaced.split(/[^A-Za-z0-9]+/)) {
      if (!part) continue;
      const lower = part.toLowerCase();
      if (STOP_WORDS.has(lower)) continue;
      tokens.push(lower);
    }
  }
  return tokens;
}

// Build the weighted query term counter. Longer / domain / repeated tokens
// get extra weight, and a soft singular form is added so "refunds" and
// "refund" both light up.
/**
 * @param {string} request
 * @returns {Map<string, number>}
 */
export function weightedQueryTerms(request) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const token of tokenize(request)) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  /** @type {Map<string, number>} */
  const weighted = new Map();
  for (const [term, count] of counts) {
    let weight = count;
    if (term.length >= 6) weight += 1;
    if (DOMAIN_KEYWORDS.has(term)) weight += 2;
    weighted.set(term, weight);
    // Query terms only get a softer (length > 4) singular fold so very short
    // tokens like "apis" aren't stemmed into a different concept here; the
    // actual stemming rules are shared from risk-paths so path classification
    // and query weighting stay in sync.
    const singular = term.length > 4 ? singularizeToken(term) : term;
    if (singular !== term) {
      weighted.set(singular, Math.max(weighted.get(singular) ?? 0, Math.max(1, weight - 1)));
    }
  }
  return weighted;
}

/**
 * @param {string[]} tokens
 * @returns {Map<string, number>}
 */
function countTokens(tokens) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
}

/**
 * @param {Map<string, number>} counts
 * @param {Map<string, number>} weightedQuery
 * @returns {string[]}
 */
function matchedTerms(counts, weightedQuery) {
  /** @type {string[]} */
  const hits = [];
  for (const term of counts.keys()) if (weightedQuery.has(term)) hits.push(term);
  return hits.sort();
}

/**
 * @param {Map<string, number>} weightedQuery
 * @param {string[]} tokens
 * @returns {boolean}
 */
function queryMentions(weightedQuery, tokens) {
  return tokens.some((token) => weightedQuery.has(token));
}

/**
 * @param {string} filePath
 * @param {Map<string, number>} weightedQuery
 * @returns {number}
 */
function computeConfigBonus(filePath, weightedQuery) {
  const lower = filePath.toLowerCase();
  let bonus = 0;
  for (const [term, hints] of Object.entries(CONFIG_HINTS)) {
    if (!weightedQuery.has(term)) continue;
    if (hints.some((hint) => lower.includes(hint))) bonus += W_CONFIG_HINT;
  }
  return bonus;
}

/**
 * @param {Map<string, string[]>} map
 * @param {string} key
 * @param {string} value
 */
function pushTo(map, key, value) {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

/**
 * @param {string[]} values
 * @returns {string[]}
 */
function dedupe(values) {
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {string[]} */
  const out = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clampInt(value, fallback, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < min) return fallback;
  return Math.min(max, Math.floor(num));
}

/**
 * @param {number} value
 * @returns {number}
 */
function round(value) {
  return Math.round(value * 10) / 10;
}

export const RANK_GLYPHS = ["🥇", "🥈", "🥉", "🏅", "🏅"];

/**
 * @param {ReturnType<typeof generateImpact>['data']} data
 * @param {(options: Record<string, unknown>) => any} rendererFactory
 * @returns {string}
 */
export function formatImpactTerminal(data, rendererFactory) {
  /** @type {string[]} */
  const lines = [];
  const renderer = rendererFactory({});
  const headlines = [
    { text: `"${data.query}"`, glyph: "💬" },
    { text: `${data.repo.root} · ${data.repo.sourceFileCount} source file(s)`, glyph: "📂" },
  ];
  lines.push(renderer.header({ text: "otito impact · change blast radius", glyph: "🎯" }, headlines));
  lines.push("");
  if (data.concepts.length) {
    lines.push(
      `  ${renderer.emoji ? "🧠" : "[?]"}  concepts: ${data.concepts.map((/** @type {string} */ c) => `${glyphFor(c) || ""} ${c}`.trim()).join(" · ")}`,
    );
    lines.push("");
  }
  for (const [index, file] of data.topFiles.entries()) {
    const rank = renderer.emoji ? (RANK_GLYPHS[index] ?? "  ") : `${(index + 1).toString().padStart(2, " ")}.`;
    lines.push(`  ${rank}  ${file.path}    score ${file.score}`);
    lines.push(`       ${renderer.emoji ? "└─" : "|-"} role: ${file.role}`);
    for (const reason of file.reasons.slice(0, 4)) {
      lines.push(`       ${renderer.emoji ? "└─" : "|-"} ${reason}`);
    }
    if (file.riskFlags.length) {
      lines.push(
        `       ${renderer.emoji ? "└─" : "|-"} risk: ${file.riskFlags.map((/** @type {string} */ flag) => `${glyphFor(flag) || ""} ${flag}`.trim()).join(" · ")}`,
      );
    }
    lines.push("");
  }
  lines.push(
    renderer.section(
      `${renderer.emoji ? "🧪" : ">"} Suggested tests`,
      data.testSuggestions.slice(0, 8).map((/** @type {string} */ t) => `${renderer.emoji ? "•" : "-"} ${t}`),
    ),
  );
  lines.push("");
  lines.push(
    renderer.section(
      `${renderer.emoji ? "🚨" : ">"} Risk hotspots`,
      data.risks.slice(0, 6).map((/** @type {string} */ r) => `${renderer.emoji ? "•" : "-"} ${r}`),
    ),
  );
  lines.push("");
  lines.push(
    renderer.section(
      `${renderer.emoji ? "📋" : ">"} Implementation plan`,
      data.implementationPlan.map((/** @type {string} */ step, /** @type {number} */ i) => `${i + 1}. ${step}`),
    ),
  );
  if (data.validation) {
    lines.push("");
    const v = data.validation;
    lines.push(
      renderer.section(
        `${renderer.emoji ? "🔍" : ">"} Diff validation (base ${v.base})`,
        v.ok
          ? [
              `verdict: ${v.verdict}`,
              `confirmed direct: ${formatList(v.confirmedDirect)}`,
              `confirmed related: ${formatList(v.confirmedRelated)}`,
              `unconfirmed candidates: ${formatList(v.unconfirmedCandidates)}`,
              `unexplained changed files: ${formatList(v.missedChangedFiles)}`,
            ]
          : [`error: ${v.error}`],
      ),
    );
  }
  lines.push("");
  lines.push(`  ${renderer.emoji ? "📦" : "[i]"} Token estimate: JSON ${data.tokenEstimate.fullJson} · markdown ${data.tokenEstimate.markdown}`);
  return lines.join("\n");
}

/**
 * Mermaid flowchart: query → concepts → top files → related files.
 * @param {ReturnType<typeof generateImpact>['data']} data
 * @returns {string}
 */
export function formatImpactMermaid(data) {
  const lines = ["flowchart TD"];
  const query = (data.query ?? "query").slice(0, 60).replace(/"/g, "'");
  lines.push(`    Q["🔍 ${query}"]`);

  const concepts = (data.concepts ?? []).slice(0, 5);
  for (const [i, concept] of concepts.entries()) {
    lines.push(`    C${i}["💡 ${concept}"]`);
    lines.push(`    Q --> C${i}`);
  }

  const topFiles = (data.topFiles ?? []).slice(0, 8);
  const seenRelated = new Set();
  const relatedIds = uniqueIds();

  for (const [fi, file] of topFiles.entries()) {
    const basename = file.path.split("/").pop() ?? file.path;
    // Mermaid renders <br/> as a line break; a literal \n is shown as text.
    const label = `${basename}<br/>score: ${file.score}`.replace(/"/g, "'");
    lines.push(`    F${fi}["📄 ${label}"]`);
    // Attach to first concept that matches the file's domain, else concept 0 or query.
    const ci = concepts.findIndex(
      (/** @type {string} */ c) => file.domain?.includes(c) || (file.reasons ?? []).some((/** @type {string} */ r) => r.toLowerCase().includes(c)),
    );
    if (ci >= 0) lines.push(`    C${ci} --> F${fi}`);
    else if (concepts.length === 0) lines.push(`    Q --> F${fi}`);
    else lines.push(`    C0 --> F${fi}`);

    for (const rel of (file.relatedFiles ?? []).slice(0, 3)) {
      if (seenRelated.has(rel)) continue;
      seenRelated.add(rel);
      const relBase = (rel.split("/").pop() ?? rel).replace(/"/g, "'");
      const rid = relatedIds(`R_${mId(rel)}`);
      lines.push(`    ${rid}["${relBase}"]`);
      lines.push(`    F${fi} -.-> ${rid}`);
    }
  }

  return lines.join("\n");
}

/** @param {string} text @returns {string} */
function mId(text) {
  return String(text)
    .replace(/[^a-zA-Z0-9]/g, "_")
    .replace(/^(\d)/, "_$1");
}

/**
 * Returns a function that maps a candidate Mermaid node id to a collision-free
 * id, appending a numeric suffix when distinct labels sanitize to the same base.
 * @returns {(base: string) => string}
 */
function uniqueIds() {
  /** @type {Set<string>} */
  const used = new Set();
  return (base) => {
    let id = base;
    let n = 1;
    while (used.has(id)) id = `${base}_${n++}`;
    used.add(id);
    return id;
  };
}
